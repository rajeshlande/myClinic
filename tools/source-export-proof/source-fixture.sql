-- SYNTHETIC LOCAL TEST CLUSTER ONLY. NOT a clinical/Master migration.
-- No public/auth schema, app version, account, tenant flag or hosted project used.
-- Deliberately serializes tracked writers for commit-order proof; not approved
-- for clinical installation/performance. Starts only in a fresh private schema.
CREATE SCHEMA p7_source_fixture;
CREATE TABLE p7_source_fixture.writer_mutex(id boolean PRIMARY KEY CHECK(id));
INSERT INTO p7_source_fixture.writer_mutex VALUES(true);
CREATE TABLE p7_source_fixture.streams(clinic_id uuid PRIMARY KEY,stream_id text NOT NULL,head bigint NOT NULL DEFAULT 0,retained_from bigint NOT NULL DEFAULT 1);
INSERT INTO p7_source_fixture.streams(clinic_id,stream_id) VALUES
('00000000-0000-0000-0000-000000000001','fixture-stream-v1'),('00000000-0000-0000-0000-000000000002','fixture-stream-v1');
CREATE TABLE p7_source_fixture.journal_tx(clinic_id uuid NOT NULL,sequence bigint NOT NULL,txid text NOT NULL,event_count integer NOT NULL DEFAULT 0,PRIMARY KEY(clinic_id,sequence),UNIQUE(clinic_id,txid));
CREATE TABLE p7_source_fixture.journal_event(clinic_id uuid NOT NULL,sequence bigint NOT NULL,ordinal integer NOT NULL,table_name text NOT NULL,operation text NOT NULL,row_data jsonb,key_data jsonb,PRIMARY KEY(clinic_id,sequence,ordinal),FOREIGN KEY(clinic_id,sequence) REFERENCES p7_source_fixture.journal_tx ON DELETE CASCADE);
CREATE TABLE p7_source_fixture.patients(clinic_id uuid NOT NULL REFERENCES p7_source_fixture.streams,id uuid PRIMARY KEY,label text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(clinic_id,id));
CREATE TABLE p7_source_fixture.appointments(clinic_id uuid NOT NULL REFERENCES p7_source_fixture.streams,id uuid PRIMARY KEY,patient_id uuid NOT NULL,status text NOT NULL,FOREIGN KEY(clinic_id,patient_id) REFERENCES p7_source_fixture.patients(clinic_id,id) ON DELETE CASCADE);
CREATE TABLE p7_source_fixture.staff_branches(clinic_id uuid NOT NULL REFERENCES p7_source_fixture.streams,staff_id uuid NOT NULL,branch_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(clinic_id,staff_id,branch_id));
CREATE FUNCTION p7_source_fixture.emit(c uuid,t text,op text,data jsonb,k jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,p7_source_fixture AS $$
DECLARE seq bigint; ord integer; xid text:=pg_current_xact_id()::text;
BEGIN
  -- Held until source COMMIT/ROLLBACK: next writer cannot publish a later
  -- sequence before this transaction commits. A sequence allocation alone
  -- (nextval) does NOT provide this property and is intentionally not used.
  PERFORM id FROM p7_source_fixture.writer_mutex WHERE id=true FOR UPDATE;
  SELECT sequence INTO seq FROM p7_source_fixture.journal_tx WHERE clinic_id=c AND txid=xid;
  IF seq IS NULL THEN
    UPDATE p7_source_fixture.streams SET head=head+1 WHERE clinic_id=c RETURNING head INTO seq;
    IF seq IS NULL THEN RAISE EXCEPTION 'unknown fixture scope'; END IF;
    INSERT INTO p7_source_fixture.journal_tx(clinic_id,sequence,txid) VALUES(c,seq,xid);
  END IF;
  UPDATE p7_source_fixture.journal_tx SET event_count=event_count+1 WHERE clinic_id=c AND sequence=seq RETURNING event_count INTO ord;
  INSERT INTO p7_source_fixture.journal_event VALUES(c,seq,ord,t,op,data,k);
END $$;
CREATE FUNCTION p7_source_fixture.track_row() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,p7_source_fixture AS $$
DECLARE before_row jsonb; after_row jsonb; old_key jsonb; new_key jsonb; columns text[]:=string_to_array(TG_ARGV[0],','); c uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN
    before_row:=to_jsonb(OLD);
    SELECT jsonb_object_agg(k,before_row->k) INTO old_key FROM unnest(columns||ARRAY['clinic_id']) AS k;
  END IF;
  IF TG_OP<>'DELETE' THEN
    after_row:=to_jsonb(NEW);
    SELECT jsonb_object_agg(k,after_row->k) INTO new_key FROM unnest(columns||ARRAY['clinic_id']) AS k;
  END IF;
  IF TG_OP='UPDATE' AND before_row->>'clinic_id' IS DISTINCT FROM after_row->>'clinic_id' THEN RAISE EXCEPTION 'scope move refused'; END IF;
  c:=coalesce(after_row->>'clinic_id',before_row->>'clinic_id')::uuid;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND old_key IS DISTINCT FROM new_key) THEN
    PERFORM p7_source_fixture.emit(c,TG_TABLE_NAME,'delete',NULL,old_key);
  END IF;
  IF TG_OP<>'DELETE' THEN
    PERFORM p7_source_fixture.emit(c,TG_TABLE_NAME,'upsert',after_row,NULL);
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION p7_source_fixture.refuse_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture truncate unsupported'; END $$;
CREATE TRIGGER patients_journal AFTER INSERT OR UPDATE OR DELETE ON p7_source_fixture.patients FOR EACH ROW EXECUTE FUNCTION p7_source_fixture.track_row('id');
CREATE TRIGGER appointments_journal AFTER INSERT OR UPDATE OR DELETE ON p7_source_fixture.appointments FOR EACH ROW EXECUTE FUNCTION p7_source_fixture.track_row('id');
CREATE TRIGGER staff_branches_journal AFTER INSERT OR UPDATE OR DELETE ON p7_source_fixture.staff_branches FOR EACH ROW EXECUTE FUNCTION p7_source_fixture.track_row('staff_id,branch_id');
CREATE TRIGGER patients_no_truncate BEFORE TRUNCATE ON p7_source_fixture.patients FOR EACH STATEMENT EXECUTE FUNCTION p7_source_fixture.refuse_truncate();
CREATE TRIGGER appointments_no_truncate BEFORE TRUNCATE ON p7_source_fixture.appointments FOR EACH STATEMENT EXECUTE FUNCTION p7_source_fixture.refuse_truncate();
CREATE TRIGGER staff_branches_no_truncate BEFORE TRUNCATE ON p7_source_fixture.staff_branches FOR EACH STATEMENT EXECUTE FUNCTION p7_source_fixture.refuse_truncate();
