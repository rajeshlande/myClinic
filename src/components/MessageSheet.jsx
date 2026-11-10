import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Image, MessageSquare, Send, Share2 } from 'lucide-react';
import { useStore } from '../lib/store.jsx';
import { Badge, Button, Field, Modal, Textarea, useToast } from './ui.jsx';
import { canMessage, waLink } from '../lib/messages.mjs';
import { today } from '../lib/logic.mjs';
import { TokenSlip } from './TokenSlip.jsx';
import { slipCaption } from '../lib/token-slip.mjs';
import { canShareFiles, downloadSlip, shareSlip, slipPngFile } from '../lib/token-slip-image.js';

/**
 * One composer for every patient message.
 *
 * WhatsApp is opened through `wa.me` — the desk sends from the clinic's own
 * number, so nothing needs a BSP, a template approval or a server. That also
 * means the product cannot know whether the person actually pressed send, which
 * is why "opened" and "sent" are two separate log entries and the last button
 * says **Mark sent**: the log records what a human did, never a guess.
 *
 * Everything is visible before it leaves: the number it will open, the exact
 * text, and — when the patient has opted out or the number is unusable — the
 * reason instead of a disabled button with no explanation.
 *
 * v1.35.3 adds an optional `slip` model. A `wa.me` link cannot carry an image,
 * so the slip goes through the OS share sheet (`navigator.share({ files, text })`)
 * where the device supports it — image *and* message in one hand-off — with a PNG
 * download for desktops. Without `slip` this is exactly the composer the other
 * four screens already use.
 */
export default function MessageSheet({ open, onClose, patient, message, slip = null }) {
  const store = useStore();
  const toast = useToast();
  // Seed from the message itself, not only from an effect: an effect does not
  // run during server rendering, and the composer must show the exact text from
  // its first paint (the smoke asserts this without a DOM to run effects in).
  const [text, setText] = useState(() => message?.text ?? '');
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText(message?.text ?? '');
      setOpened(false);
    }
  }, [open, message?.text]);

  const consent = canMessage(patient);
  const link = consent.ok ? waLink(patient?.phone, text) : '';
  // `canShareFiles` touches navigator, so it is only asked while the sheet is
  // open on a real client; SSR sees false and simply offers the download.
  const shareable = useMemo(() => Boolean(open && slip && canShareFiles()), [open, slip]);

  // Has this exact thing been messaged today already? The log is the source of
  // truth, and telling the desk now is cheaper than a patient being chased twice.
  const sentToday = useMemo(() => {
    if (!open || !message?.key) return null;
    return (store.reminders ?? []).find(
      (r) => r.draft_key === message.key && r.logged_on === today() && r.status !== 'skipped',
    ) ?? null;
  }, [open, message?.key, store.reminders]);

  async function log(status, channel) {
    try {
      await store.create('reminders', {
        patient_id: patient?.id ?? null,
        draft_key: message.key,
        kind: message.kind,
        ref_id: null,
        channel,
        status,
        body: String(text).slice(0, 1200),
        logged_on: today(),
        sent_at: status === 'sent' ? new Date().toISOString() : null,
        sent_by: store.currentStaff?.id ?? null,
      });
      return true;
    } catch (e) {
      toast.error(e.message ?? 'Could not write to the message log.');
      return false;
    }
  }

  /** Write to the clipboard, but never wait on it forever — a prompt nobody
   *  answers must not stop the log entry from being written. */
  async function copyText() {
    const write = navigator.clipboard?.writeText(text).then(() => true).catch(() => false) ?? Promise.resolve(false);
    const ceiling = new Promise((resolve) => setTimeout(() => resolve(false), 2000));
    return Promise.race([write, ceiling]);
  }

  async function copy() {
    const copied = await copyText();
    if (await log('copied', 'copy')) {
      if (copied) toast.success('Message copied.');
      else toast.info('The log is written, but this browser blocked the clipboard.');
    }
  }

  async function send() {
    if (!link) return;
    setBusy(true);
    setOpened(true);
    // The log entry is written *before* the hand-off: an installed PWA, a pop-up
    // blocker or a browser that never answers a clipboard prompt must not be able
    // to lose the fact that this patient was messaged.
    if (await log('opened', 'whatsapp')) {
      const win = window.open(link, '_blank', 'noopener');
      if (win) {
        toast.info('WhatsApp opened — tap Mark sent once it is away.');
      } else {
        await copyText();
        await log('copied', 'copy');
        toast.info('The browser blocked the new tab, so the message is on your clipboard instead.');
      }
    }
    setBusy(false);
  }

  /** The slip image and the exact text leave together through the OS share sheet. */
  async function share() {
    if (!consent.ok || !slip) return;
    setBusy(true);
    try {
      const file = await slipPngFile(slip);
      if (!canShareFiles(file)) {
        await download();
        return;
      }
      try {
        await shareSlip({ file, text, title: `Token ${slip.token}` });
      } catch (e) {
        if (e?.name === 'AbortError') { toast.info('Sharing cancelled.'); return; }
        throw e;
      }
      setOpened(true);
      if (await log('opened', 'whatsapp')) toast.success('Slip and message shared — tap Mark sent once they are away.');
    } catch (e) {
      toast.error(e.message ?? 'Could not share the slip image.');
    } finally {
      setBusy(false);
    }
  }

  /** Desktop fallback: a real PNG the desk attaches in WhatsApp Web by hand. */
  async function download() {
    if (!slip) return;
    try {
      const name = await downloadSlip(slip);
      toast.success(`${name} downloaded — attach it in WhatsApp.`);
    } catch (e) {
      toast.error(e.message ?? 'Could not make the slip image.');
    }
  }

  async function markSent() {
    if (await log('sent', 'whatsapp')) {
      toast.success(`Logged as sent to ${patient?.full_name ?? 'the patient'}.`);
      onClose?.();
    }
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>Close</Button>
      <span className="spacer" />
      <Button variant="subtle" icon={Copy} onClick={copy} disabled={!text.trim()}>Copy</Button>
      {slip ? <Button variant="subtle" icon={Download} onClick={download}>Download slip PNG</Button> : null}
      {opened ? <Button variant="subtle" icon={Check} onClick={markSent}>Mark sent</Button> : null}
      {slip && shareable ? (
        <>
          <Button variant="ghost" icon={Send} onClick={send} disabled={!consent.ok || busy}>Text only</Button>
          <Button variant="primary" icon={Share2} onClick={share} disabled={!consent.ok || busy}>
            Share image + message
          </Button>
        </>
      ) : (
        <Button variant="primary" icon={Send} onClick={send} disabled={!consent.ok || busy}>
          Open WhatsApp
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Message ${patient?.full_name ?? 'the patient'}`}
      sub="Sends from the clinic's own WhatsApp number. Nothing leaves until you press send there."
      footer={footer}
    >
      <div className="stack" style={{ gap: 12 }}>
        <Field label="To">
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <span className="mono small strong">{patient?.phone || '—'}</span>
            {consent.ok ? <Badge tone="success" dot>WhatsApp</Badge> : <Badge tone="danger" dot>Not messageable</Badge>}
            {sentToday ? <Badge tone="warn">Already sent today</Badge> : null}
          </div>
        </Field>

        {!consent.ok ? (
          <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{consent.reason}</p>
        ) : null}

        {sentToday && consent.ok ? (
          <p className="tiny faint" style={{ margin: 0 }}>
            The log already has this exact message for today — sending again is allowed, just not silent.
          </p>
        ) : null}

        {slip ? (
          <Field label="Token slip image" hint="The same slip that prints, as a PNG.">
            <div className="token-slip-compose">
              <TokenSlip model={slip} className="token-slip-thumb" />
              <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                <span className="small strong">{slip.token} · {slip.clinicName}</span>
                <span className="tiny muted">{slipCaption(slip)}</span>
                <span className="tiny faint">
                  {shareable
                    ? 'Share image + message opens your share sheet — choose WhatsApp and both arrive together.'
                    : 'This browser cannot share files. Download the PNG, then attach it to the WhatsApp message.'}
                </span>
              </div>
            </div>
          </Field>
        ) : null}

        <Field label="Message" hint={`${text.length} / 1200 characters — edit before sending if you need to.`}>
          <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value.slice(0, 1200))} />
        </Field>

        <p className="tiny faint" style={{ margin: 0 }}>
          {slip ? <Image size={12} /> : <MessageSquare size={12} />} Appointment and token messages carry the time, the doctor and the clinic —
          never the diagnosis. The prescription carries the medicines because the patient has to read them.
        </p>
      </div>
    </Modal>
  );
}
