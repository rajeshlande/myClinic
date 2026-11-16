#!/usr/bin/env python3
"""SYNTHETIC ONLY: private Unix-socket cluster, fresh fixture schema, no hosted DSN."""
import json, os, pathlib, sys, threading, time
import psycopg2
from psycopg2 import extensions

if len(sys.argv)!=3:
    raise SystemExit('Usage: verify-postgres.py PRIVATE_SOCKET_DIR SYNTHETIC_OUTPUT_JSON')
socket=pathlib.Path(sys.argv[1]).resolve()
if socket.name!='socket' or socket.parent.name!='p7-source-pg' or socket.parent.parent.name!='.arena' or socket.stat().st_mode & 0o077:
    raise SystemExit('Private synthetic socket path required')
output=pathlib.Path(sys.argv[2]).resolve()
if '.arena' not in output.parts:
    raise SystemExit('Synthetic output must stay in scratch .arena')
def connect():
    c=psycopg2.connect(host=str(socket),port=55437,user='source_fixture',dbname='postgres')
    with c.cursor() as q:
        q.execute('SELECT inet_server_addr(),current_user')
        if q.fetchone()!=(None,'source_fixture'):
            raise RuntimeError('Not the private source fixture')
    c.commit()
    return c
A='00000000-0000-0000-0000-000000000001'
B='00000000-0000-0000-0000-000000000002'
P1='10000000-0000-0000-0000-000000000001'
P2='10000000-0000-0000-0000-000000000002'
P3='10000000-0000-0000-0000-000000000003'
PB='20000000-0000-0000-0000-000000000001'
BR='30000000-0000-0000-0000-000000000001'
BR2='30000000-0000-0000-0000-000000000002'
ST='40000000-0000-0000-0000-000000000001'
AP='50000000-0000-0000-0000-000000000001'
TABLES=['patients','appointments','staff_branches']
checks={}
def tx(statements):
    c=connect()
    try:
        with c.cursor() as q:
            for sql,args in statements:q.execute(sql,args)
        c.commit()
    finally:c.close()
def snapshot(clinic=A):
    c=connect();c.set_session(isolation_level=extensions.ISOLATION_LEVEL_REPEATABLE_READ,readonly=True)
    q=c.cursor();q.execute('SELECT head,retained_from,stream_id,pg_current_snapshot()::text FROM p7_source_fixture.streams WHERE clinic_id=%s',(clinic,))
    head,floor,stream,snapshot_id=q.fetchone()
    return c,q,{'source':{'project':'synthetic-source','clinicId':clinic,'schema':22,'streamId':stream},'snapshotId':'snapshot-'+snapshot_id.replace(':','-').replace(',','_'),'complete':True,'high':head,'retainedFrom':floor}
def rows(q,clinic=A):
    result={}
    for table in TABLES:
        # Table names are fixed fixture constants, never external identifiers.
        q.execute('SELECT to_jsonb(t) FROM p7_source_fixture.'+table+' t WHERE clinic_id=%s ORDER BY to_jsonb(t)::text',(clinic,))
        result[table]=[r[0] for r in q.fetchall()]
    return result
c=connect()
try:
    with c.cursor() as q:q.execute(pathlib.Path(__file__).with_name('source-fixture.sql').read_text())
    c.commit()
finally:c.close()
tx([('INSERT INTO p7_source_fixture.patients(clinic_id,id,label,updated_at) VALUES(%s,%s,%s,%s)',(A,P1,'SYNTHETIC_ONE','2026-01-01T00:00:00Z')),('INSERT INTO p7_source_fixture.patients(clinic_id,id,label,updated_at) VALUES(%s,%s,%s,%s)',(A,P2,'SYNTHETIC_TWO','2026-01-01T00:00:00Z')),('INSERT INTO p7_source_fixture.appointments VALUES(%s,%s,%s,%s)',(A,AP,P1,'waiting')),('INSERT INTO p7_source_fixture.staff_branches VALUES(%s,%s,%s,true)',(A,ST,BR))])
tx([('INSERT INTO p7_source_fixture.patients(clinic_id,id,label) VALUES(%s,%s,%s)',(B,PB,'OTHER_CLINIC_SENTINEL'))])
reader,q,baseline=snapshot()
try:
    assert baseline['high']==1
    tx([('UPDATE p7_source_fixture.patients SET label=%s WHERE id=%s',('SYNTHETIC_UPDATED_SAME_TIMESTAMP',P1)),('DELETE FROM p7_source_fixture.patients WHERE id=%s',(P2,)),('INSERT INTO p7_source_fixture.patients(clinic_id,id,label) VALUES(%s,%s,%s)',(A,P3,'SYNTHETIC_THREE')),('UPDATE p7_source_fixture.appointments SET status=%s WHERE id=%s',('seen',AP)),('UPDATE p7_source_fixture.staff_branches SET active=false WHERE clinic_id=%s',(A,))])
    baseline['tables']=rows(q)
    assert baseline['tables']['patients'][0]['label'] in ['SYNTHETIC_ONE','SYNTHETIC_TWO']
    assert {p['label'] for p in baseline['tables']['patients']}=={'SYNTHETIC_ONE','SYNTHETIC_TWO'}
    checks['repeatable_baseline_during_commit']=True
finally:reader.close()
rollback=connect()
try:
    with rollback.cursor() as q:q.execute('UPDATE p7_source_fixture.patients SET label=%s WHERE id=%s',('ROLLED_BACK_SENTINEL',P1))
    rollback.rollback()
finally:rollback.close()
c,q,w=snapshot();checks['rollback_has_no_sequence_hole']=(w['high']==2);c.close()
tx([('UPDATE p7_source_fixture.staff_branches SET branch_id=%s WHERE clinic_id=%s',(BR2,A))])
# Prove second tracked writer waits for the first transaction's commit lock.
a=connect();b=connect();started=threading.Event();finished=threading.Event();errors=[]
with a.cursor() as q:q.execute('UPDATE p7_source_fixture.patients SET label=%s WHERE id=%s',('COMMIT_FIRST',P1))
bpid=b.get_backend_pid()
def second_writer():
    try:
        with b.cursor() as q:
            started.set();q.execute('UPDATE p7_source_fixture.patients SET label=%s WHERE id=%s',('COMMIT_SECOND',P3))
        b.commit()
    except Exception as e:errors.append(type(e).__name__)
    finally:finished.set()
t=threading.Thread(target=second_writer);t.start()
try:
    assert started.wait(5)
    monitor=connect()
    try:
        deadline=time.monotonic()+5;blocked=False
        while time.monotonic()<deadline:
            with monitor.cursor() as q:q.execute('SELECT pg_blocking_pids(%s)',(bpid,));blocked=a.get_backend_pid() in q.fetchone()[0]
            monitor.rollback()
            if blocked:break
            finished.wait(.01)
        assert blocked and not finished.is_set()
        checks['concurrent_writer_waits_for_commit']=True
    finally:monitor.close()
    a.commit();assert finished.wait(5);assert not errors
finally:
    a.rollback();a.close();t.join(5);b.close()
# Same source transaction modifies both tenants; each stream keeps only its rows.
tx([('UPDATE p7_source_fixture.patients SET label=%s WHERE id=%s',('FINAL_SYNTHETIC_ONE',P1)),('UPDATE p7_source_fixture.patients SET label=%s WHERE id=%s',('OTHER_CLINIC_SENTINEL_UPDATED',PB))])
for sql,args,name in [('TRUNCATE p7_source_fixture.patients CASCADE',(),'truncate_refused'),('UPDATE p7_source_fixture.patients SET clinic_id=%s WHERE id=%s',(B,P3),'scope_move_refused')]:
    c=connect()
    try:
        try:
            with c.cursor() as q:q.execute(sql,args)
            raise AssertionError('untracked mutation allowed')
        except psycopg2.Error:checks[name]=True;c.rollback()
    finally:c.close()
c,q,window=snapshot()
try:
    q.execute('SELECT sequence FROM p7_source_fixture.journal_tx WHERE clinic_id=%s AND sequence>%s ORDER BY sequence',(A,baseline['high']))
    seqs=[r[0] for r in q.fetchall()]
    assert seqs==list(range(2,7));checks['contiguous_commit_order']=True
    transactions=[]
    for sequence in seqs:
        q.execute('SELECT table_name,operation,row_data,key_data FROM p7_source_fixture.journal_event WHERE clinic_id=%s AND sequence=%s ORDER BY ordinal',(A,sequence))
        changes=[{'op':op,'table':table,**({'row':data} if op=='upsert' else {'key':key})} for table,op,data,key in q.fetchall()]
        transactions.append({'sequence':sequence,'changes':changes})
    window['transactions']=transactions
    expected=rows(q)
    checks['multi_table_atomic_transaction']=len(transactions[0]['changes'])==5
    checks['composite_pk_change_tombstone']= [e['op'] for e in transactions[1]['changes']]==['delete','upsert']
    checks['tenant_filter_no_other_clinic']=B not in json.dumps(window) and 'OTHER_CLINIC' not in json.dumps(window)
    checks['rollback_data_absent']='ROLLED_BACK_SENTINEL' not in json.dumps(window)
finally:c.close()
assert all(checks.values())
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps({'baseline':baseline,'increment':window,'expected':expected,'checks':checks},indent=2)+'\n')
print(json.dumps({'mode':'SYNTHETIC_POSTGRES_ONLY','ok':True,'checks':checks,'checksPassed':len(checks),'clinicalConnections':0}))
