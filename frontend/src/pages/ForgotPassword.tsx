import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, IdCard, KeyRound, MessageSquareText, ShieldCheck } from 'lucide-react';
import type { ForgotPasswordResponse } from '@shared/types';
import { useToast } from '@/context/ToastContext';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { requestPasswordCode, resetPasswordWithCode } from '@/services/authService';
import { cn } from '@/lib/utils';

/**
 * Password reset in two steps, the way departmental portals do it:
 *   1. identify the account → a one-time code goes to the registered mobile;
 *   2. enter the code and choose a new password.
 * Without an SMS gateway the API returns the code for display, clearly marked
 * as demo delivery, so the flow can be completed end to end.
 */

const FIELD =
  'flex h-14 w-full items-center gap-3 rounded-full border-2 border-slate-900/80 bg-white px-5 text-base text-slate-900 transition-colors focus-within:border-amber-500 focus-within:ring-4 focus-within:ring-amber-300/40';
const PILL =
  'mx-auto flex h-14 w-full items-center justify-center rounded-full bg-[#F6C21B] text-base font-semibold uppercase tracking-[0.16em] text-slate-900 shadow-[0_10px_30px_-10px_rgba(246,194,27,0.8)] transition-transform hover:brightness-95 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70';

interface IdentifyForm {
  identifier: string;
}
interface ResetForm {
  code: string;
  newPassword: string;
  confirm: string;
}

export default function ForgotPassword() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState<'identify' | 'reset' | 'done'>('identify');
  const [identifier, setIdentifier] = useState('');
  const [issued, setIssued] = useState<ForgotPasswordResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  const identify = useForm<IdentifyForm>({ defaultValues: { identifier: '' } });
  const reset = useForm<ResetForm>({ defaultValues: { code: '', newPassword: '', confirm: '' } });

  const onIdentify = identify.handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await requestPasswordCode({ identifier: values.identifier.trim() });
      setIdentifier(values.identifier.trim());
      setIssued(response);
      setStep('reset');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the reset.');
    }
  });

  const onReset = reset.handleSubmit(async (values) => {
    setError(null);
    try {
      await resetPasswordWithCode({ identifier, code: values.code.trim(), newPassword: values.newPassword });
      setStep('done');
      toast.success('Password changed', 'Sign in with your new password.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset the password.');
    }
  });

  const resend = async () => {
    setError(null);
    try {
      setIssued(await requestPasswordCode({ identifier }));
      reset.resetField('code');
      toast.info('New code sent', 'The previous code no longer works.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend the code.');
    }
  };

  return (
    <div className="min-h-screen bg-white px-6 py-10 text-slate-900">
      <main className="mx-auto w-full max-w-md">
        <Link to="/login" className="mx-auto block w-44" aria-label="Back to sign in">
          <BrandLogo className="h-auto w-full" />
        </Link>

        <h1
          className="mt-8 text-center text-4xl font-extrabold tracking-tight"
          style={{ fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif" }}
        >
          {step === 'done' ? 'Password changed' : 'Reset password'}
        </h1>

        {step === 'identify' && (
          <>
            <p className="mt-3 text-center text-sm leading-relaxed text-slate-600">
              Enter your Official ID or e-mail. A one-time code will be sent to the mobile number registered
              with the department.
            </p>
            <form onSubmit={onIdentify} className="mt-6 space-y-4" noValidate>
              <label className={cn(FIELD, identify.formState.errors.identifier && 'border-red-600')}>
                <IdCard size={22} className="shrink-0" aria-hidden />
                <input
                  autoComplete="username"
                  placeholder="Official ID or Email ID"
                  aria-label="Official ID or Email ID"
                  className="h-full w-full bg-transparent placeholder:text-slate-500 focus:outline-none"
                  {...identify.register('identifier', { required: 'Enter your Official ID or Email ID' })}
                />
              </label>
              {(identify.formState.errors.identifier?.message || error) && (
                <p role="alert" className="flex items-start justify-center gap-1.5 text-center text-sm font-medium text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error ?? identify.formState.errors.identifier?.message}
                </p>
              )}
              <button type="submit" disabled={identify.formState.isSubmitting} className={PILL}>
                {identify.formState.isSubmitting ? 'Sending code…' : 'Send code'}
              </button>
            </form>
          </>
        )}

        {step === 'reset' && issued && (
          <>
            <p className="mt-3 text-center text-sm leading-relaxed text-slate-600">
              {issued.channels.length > 0 ? (
                <>
                  A 6-digit code was sent to{' '}
                  {issued.channels.includes('sms') && (
                    <span className="font-semibold text-slate-800">{issued.maskedPhone}</span>
                  )}
                  {issued.channels.includes('sms') && issued.channels.includes('email') && ' and '}
                  {issued.channels.includes('email') && (
                    <span className="font-semibold text-slate-800">{issued.maskedEmail}</span>
                  )}
                  . It is valid for {issued.expiresInMinutes} minutes.
                </>
              ) : (
                <>
                  Your registered contacts are <span className="font-semibold text-slate-800">{issued.maskedPhone}</span>{' '}
                  and <span className="font-semibold text-slate-800">{issued.maskedEmail}</span>. The code is valid for{' '}
                  {issued.expiresInMinutes} minutes.
                </>
              )}
            </p>
            {issued.deliveryNote && (
              <p className="mt-2 text-center text-xs font-medium text-amber-800">{issued.deliveryNote}</p>
            )}

            {issued.demoCode && (
              <div className="mt-4 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-center">
                <p className="flex items-center justify-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-amber-800">
                  <MessageSquareText size={13} /> Demo mode · no e-mail or SMS provider connected
                </p>
                <p className="mt-1 font-mono text-3xl font-bold tracking-[0.35em] text-slate-900">{issued.demoCode}</p>
                <p className="mt-1 text-2xs text-amber-900/80">
                  In production this code reaches the officer's phone only.
                </p>
              </div>
            )}

            <form onSubmit={onReset} className="mt-6 space-y-4" noValidate>
              <label className={cn(FIELD, reset.formState.errors.code && 'border-red-600')}>
                <MessageSquareText size={22} className="shrink-0" aria-hidden />
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6-digit code"
                  aria-label="One-time code"
                  className="h-full w-full bg-transparent font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none"
                  {...reset.register('code', {
                    required: 'Enter the 6-digit code',
                    pattern: { value: /^\d{6}$/, message: 'The code is 6 digits' },
                  })}
                />
              </label>
              <label className={cn(FIELD, reset.formState.errors.newPassword && 'border-red-600')}>
                <KeyRound size={22} className="shrink-0" aria-hidden />
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="New password (8+ characters)"
                  aria-label="New password"
                  className="h-full w-full bg-transparent placeholder:text-slate-500 focus:outline-none"
                  {...reset.register('newPassword', {
                    required: 'Choose a new password',
                    minLength: { value: 8, message: 'At least 8 characters' },
                  })}
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="shrink-0 p-1 text-slate-500 hover:text-slate-800" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </label>
              <label className={cn(FIELD, reset.formState.errors.confirm && 'border-red-600')}>
                <KeyRound size={22} className="shrink-0" aria-hidden />
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  aria-label="Confirm new password"
                  className="h-full w-full bg-transparent placeholder:text-slate-500 focus:outline-none"
                  {...reset.register('confirm', {
                    required: 'Re-enter the new password',
                    validate: (v) => v === reset.watch('newPassword') || 'Passwords do not match',
                  })}
                />
              </label>

              {(error ||
                reset.formState.errors.code?.message ||
                reset.formState.errors.newPassword?.message ||
                reset.formState.errors.confirm?.message) && (
                <p role="alert" className="flex items-start justify-center gap-1.5 text-center text-sm font-medium text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error ??
                    reset.formState.errors.code?.message ??
                    reset.formState.errors.newPassword?.message ??
                    reset.formState.errors.confirm?.message}
                </p>
              )}

              <button type="submit" disabled={reset.formState.isSubmitting} className={PILL}>
                {reset.formState.isSubmitting ? 'Updating…' : 'Set new password'}
              </button>
              <p className="text-center text-sm text-slate-600">
                Did not receive it?{' '}
                <button type="button" onClick={() => void resend()} className="font-bold text-slate-900 underline underline-offset-4 hover:text-amber-700">
                  Send a new code
                </button>
              </p>
            </form>
          </>
        )}

        {step === 'done' && (
          <div className="mt-6 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={28} />
            </span>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Your password has been updated. Sign in with your Official ID and the new password.
            </p>
            <button type="button" onClick={() => navigate('/login')} className={cn(PILL, 'mt-6')}>
              Go to sign in
            </button>
          </div>
        )}

        <div className="mt-8 flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-slate-500" />
          <p className="text-2xs leading-relaxed text-slate-600">
            Codes expire after ten minutes and are voided after five wrong attempts. If your registered mobile
            number has changed, ask the department administrator to update it before resetting.
          </p>
        </div>

        {step !== 'done' && (
          <p className="mt-6 text-center text-sm">
            <Link to="/login" className="font-bold text-slate-900 underline underline-offset-4 hover:text-amber-700">
              Back to sign in
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
