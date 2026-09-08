import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Lock, ScanLine, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { DEMO_CREDENTIALS, USERS } from '@shared/data/mockData';
import { ROLE_LABEL } from '@shared/lib/format';

interface FormValues {
  officialId: string;
  password: string;
  remember: boolean;
}

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { officialId: '', password: '', remember: true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await signIn(values);
      toast.success(`Signed in as ${session.user.name}`, `${ROLE_LABEL[session.user.role]} · ${session.user.region}`);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/app', { replace: true });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Sign in failed.');
    }
  });

  const fillDemo = (officialId: string, password: string) => {
    setValue('officialId', officialId);
    setValue('password', password);
    setFormError(null);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      {/* Brand / assurance panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-10 lg:flex">
        <div className="gov-stripe absolute inset-0 opacity-60" aria-hidden />
        <div className="relative">
          <Link to="/" className="inline-flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/15">
              <ScanLine size={20} className="text-accent-400" />
            </span>
            <span>
              <span className="block text-base font-extrabold tracking-tight text-white">LM-Inspect AI</span>
              <span className="block text-2xs text-navy-300">
                Legal Metrology Packaged Commodity Compliance System
              </span>
            </span>
          </Link>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-white">
            Screening packaged commodity declarations against the LMPC Rules, 2011
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-navy-200">
            Scan a package, extract its declarations, validate them against configurable rules and compile an
            evidence-linked inspection report — with every AI finding traceable to the rule and the region of
            the label it came from.
          </p>
          <ul className="mt-7 space-y-2.5 text-sm text-navy-100">
            {[
              'Declaration-level extraction with confidence scores',
              'Evidence regions highlighted on the package image',
              'Configurable rule engine maintained by the department',
              'Audit trail on every inspection action',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-2xs leading-relaxed text-navy-300">
          AI-generated findings assist inspection and screening. Final determination is made by the authorised
          Legal Metrology official based on applicable law, rules and physical verification where required.
        </p>
      </section>

      {/* Sign-in panel */}
      <section className="flex items-center justify-center bg-slate-100 px-4 py-10 sm:px-8">
        <div className="w-full max-w-[26rem]">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-navy-900">
              <ScanLine size={20} className="text-accent-400" />
            </span>
            <div>
              <p className="text-base font-extrabold tracking-tight text-slate-900">LM-Inspect AI</p>
              <p className="text-2xs text-slate-500">Legal Metrology Compliance System</p>
            </div>
          </div>

          <div className="surface p-6 sm:p-7">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">Official sign in</h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Use your departmental official ID to access the inspection workspace.
            </p>

            {formError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5"
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-600" />
                <p className="text-xs leading-relaxed text-red-800">{formError}</p>
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
              <Field
                label="Official ID / Email"
                htmlFor="officialId"
                required
                error={errors.officialId?.message}
              >
                <Input
                  id="officialId"
                  autoComplete="username"
                  placeholder="LM-TS-INS-1042"
                  aria-invalid={!!errors.officialId}
                  {...register('officialId', { required: 'Official ID is required' })}
                />
              </Field>

              <Field label="Password" htmlFor="password" required error={errors.password?.message}>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    className="pr-10"
                    aria-invalid={!!errors.password}
                    {...register('password', { required: 'Password is required' })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:text-slate-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>

              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                    {...register('remember')}
                  />
                  Remember me on this device
                </label>
                <button
                  type="button"
                  onClick={() =>
                    toast.info(
                      'Password reset',
                      'Password resets are handled by the departmental IT administrator.',
                    )
                  }
                  className="text-xs font-semibold text-brand-700 hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              <Button type="submit" size="lg" className="w-full justify-center" loading={isSubmitting}>
                {isSubmitting ? 'Verifying credentials…' : 'Sign In'}
              </Button>
            </form>

            <div className="mt-5 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <Lock size={13} className="mt-0.5 shrink-0 text-slate-500" />
              <p className="text-2xs leading-relaxed text-slate-600">
                Authorized access only. Inspection data is protected. All actions performed in this system are
                recorded in an audit trail against your official identity.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-white p-3.5">
            <p className="label-text mb-2">Demonstration accounts</p>
            <div className="space-y-1.5">
              {DEMO_CREDENTIALS.map((c) => {
                const account = USERS.find((u) => u.officialId === c.officialId)!;
                return (
                  <button
                    key={c.officialId}
                    type="button"
                    onClick={() => fillDemo(c.officialId, c.password)}
                    className="flex w-full items-center gap-3 rounded border border-slate-200 px-2.5 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[10px] font-bold text-white">
                      {account.avatarInitials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-800">
                        {ROLE_LABEL[c.role]} · {account.name}
                      </span>
                      <span className="block truncate font-mono text-2xs text-slate-500">
                        {c.officialId} / {c.password}
                      </span>
                    </span>
                    <span className="shrink-0 text-2xs font-semibold text-brand-700">Use</span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-4 text-center text-2xs text-slate-400">
            <Link to="/" className="font-medium text-slate-500 hover:text-slate-700 hover:underline">
              Back to platform overview
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
