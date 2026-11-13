// Fixed synthetic owner UI preview only. No auth, tokens, clinical client or service.
import React,{useState,useMemo,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import DriveBackupsTab from '../../src/components/owner/DriveBackupsTab.jsx';
import {createOwnerDriveBackups} from '../../src/lib/owner-drive-backups.mjs';
import '../../src/styles.css';
function Preview(){
  const [role,setRole]=useState('owner');
  const access=useMemo(()=>({userId:'synthetic-user',clinicId:'synthetic-clinic',active:true,role}),[role]);
  const controller=useMemo(()=>createOwnerDriveBackups({getAccess:()=>access,redirectUri:'https://clinic.example/drive/callback',onConsent:()=>{throw Error('No OAuth in preview');}}),[access]);
  useEffect(()=>()=>controller.dispose(),[controller]);
  return <main style={{maxWidth:900,margin:'32px auto',padding:20}}>
    <h1>Google Drive backups</h1><p><strong>Local v2 preview — not a live clinic.</strong> No Google login, export or upload is enabled.</p>
    <label>Preview role: <select value={role} onChange={e=>setRole(e.target.value)}><option value="owner">Owner</option><option value="doctor">Doctor</option><option value="frontdesk">Front desk</option></select></label>
    <div style={{marginTop:20}}><DriveBackupsTab key={role} access={access} controller={controller}/>{role!=='owner'&&<p role="status">Google Drive backup settings are available only to the active clinic owner.</p>}</div>
  </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
