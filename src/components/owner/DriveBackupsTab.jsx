import {useState,useSyncExternalStore} from 'react';
import {Cloud,ShieldCheck} from 'lucide-react';
import {Button,Card,CardHead} from '../ui.jsx';

/** Staged v2 settings tab. Host must remount on user/clinic changes and invalidate
 * controller on logout/membership change. Backend checks ownership independently.
 * Not mounted in the legacy Settings/router until v2 backend is configured.
 */
export default function DriveBackupsTab({access,controller}){
  const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const [consent,setConsent]=useState(false);
  const [confirmDisconnect,setConfirmDisconnect]=useState(false);
  if(access?.active!==true||access?.role!=='owner')return null;
  const busy=snapshot.phase==='BUSY';
  const unavailable=!snapshot.configured||snapshot.phase==='FORBIDDEN'||snapshot.phase==='DISPOSED';
  return <Card>
    <CardHead title="Encrypted Google Drive backups" sub="Owner access only · separate Google account connection" icon={Cloud}/>
    <div className="card-body stack" style={{gap:12}}>
      <p>Connect a Google account you control to store encrypted clinic backups. This does not change your clinic login or give staff access to your Drive.</p>
      <p className="small muted"><ShieldCheck size={15}/> Backup files are encrypted before upload. Recovery keys are kept separately from Google Drive. Connecting an account is not proof of a completed backup or restore.</p>
      {!snapshot.configured&&<p role="status">Not available yet: Google OAuth and the protected backup service must be configured by the administrator. No Google account is connected through this screen.</p>}
      <p role="status">Connection: {snapshot.connected?'Connected':'Not connected / not verified'}</p>
      <p className="small">Last verified backup: {snapshot.lastBackupAt===null?'No evidence':new Date(snapshot.lastBackupAt).toLocaleString()}</p>
      {snapshot.error&&<p role="alert">{snapshot.error}</p>}
      {!snapshot.connected?<>
        <label className="row" style={{gap:8}}><input type="checkbox" checked={consent} disabled={busy||unavailable} onChange={e=>setConsent(e.target.checked)}/>I authorise encrypted clinic backups to my selected Google Drive account and understand that recovery needs a separate key.</label>
        <Button variant="primary" disabled={!consent||busy||unavailable} onClick={()=>controller.connect()}>Connect Google Drive</Button>
      </>:<>
        <p className="small muted">Daily changed-row backups and 30-day retention require an active server-side exporter. This screen does not promise that a schedule is running.</p>
        <Button disabled={busy||unavailable} onClick={()=>controller.backupNow()}>Request encrypted backup</Button>
        <label className="row" style={{gap:8}}><input type="checkbox" checked={confirmDisconnect} onChange={e=>setConfirmDisconnect(e.target.checked)} disabled={busy||unavailable}/>Disconnect this clinic's Drive connection. Existing backup files are not deleted.</label>
        <Button disabled={!confirmDisconnect||busy||unavailable} onClick={()=>controller.disconnect()}>Disconnect Google Drive</Button>
      </>}
      <Button variant="subtle" disabled={busy||unavailable} onClick={()=>controller.refresh()}>Refresh backup status</Button>
    </div>
  </Card>;
}
