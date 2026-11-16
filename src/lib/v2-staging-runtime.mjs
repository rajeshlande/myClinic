// Staging-only composition. No browser storage, legacy imports or automatic boot.
import { createWorkspaceController } from './workspace-controller.mjs';
import { validateClinicalDescriptor } from './tenant-client.mjs';
export const STAGING_MASTER = 'https://inaqzvzfongngahxptzw.supabase.co';
export const STAGING_CLINICAL = 'https://kvxmcdezpozkvdmvmicr.supabase.co';
export function stagingConfig(env = {}) {
  const url = String(env.VITE_CENTRAL_SUPABASE_URL ?? '').trim();
  const key = String(env.VITE_CENTRAL_SUPABASE_ANON_KEY ?? '').trim();
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey) {
    try {
      const part = key.split('.')[1];
      const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      publicKey = key.split('.').length === 3 && claims.role === 'anon' && claims.ref === 'inaqzvzfongngahxptzw';
    } catch { publicKey = false; }
  }
  if (url !== STAGING_MASTER || !publicKey || /service_role|sb_secret|sbp_/i.test(key)) return Object.freeze({ok:false});
  return Object.freeze({ok:true,url,key});
}
export function createStagingRuntime({ env, createClient, mountClinicalClient } = {}) {
  const config = stagingConfig(env);
  if (!config.ok || typeof createClient !== 'function' || typeof mountClinicalClient !== 'function') throw Error('STAGING_CONFIG_REQUIRED');
  const master = createClient(config.url, config.key, {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'myclinic.staging.memory'}});
  const scopedMaster = {auth:{getUser:()=>master.auth.getUser(),
    onAuthStateChange:(fn)=>master.auth.onAuthStateChange(fn),
    signOut:()=>master.auth.signOut({scope:'local'})},
    async rpc(...args) {
      const result = await master.rpc(...args);
      const data = result?.data;
      if (data?.clinical || data?.clinical_url) {
        const checked = validateClinicalDescriptor(data.clinical ?? data);
        if (!checked.ok || checked.url !== STAGING_CLINICAL) throw Error('STAGING_DESTINATION_REFUSED');
      }
      return result;
    }, functions:{invoke:(...args)=>master.functions.invoke(...args)}};
  const controller = createWorkspaceController({masterClient:scopedMaster, masterUrl:config.url,
    mountClinicalClient(descriptor,provider) {
      const checked = validateClinicalDescriptor(descriptor);
      if (!checked.ok || checked.url !== STAGING_CLINICAL) throw Error('STAGING_DESTINATION_REFUSED');
      return mountClinicalClient(descriptor,provider);
    }});
  let busy = false;
  return Object.freeze({controller,
    async signIn(email,password) {
      if (busy) throw Error('STAGING_BUSY');
      busy = true;
      try {
        const result = await master.auth.signInWithPassword({email,password});
        if (result?.error || !result?.data?.user?.id) throw Error('STAGING_SIGN_IN_REFUSED');
        return await controller.boot();
      } catch { throw Error('STAGING_SIGN_IN_REFUSED'); }
      finally { busy = false; }
    },
    // Local sign-out only: do not revoke sessions used in another app/tab.
    async close() { await controller.dispose(); await master.auth.signOut({scope:'local'}); },
  });
}
