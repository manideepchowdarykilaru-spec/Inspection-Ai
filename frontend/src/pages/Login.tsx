import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, Eye, EyeOff, IdCard, KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { DEMO_CREDENTIALS, USERS } from '@shared/data/mockData';
import { ROLE_LABEL } from '@shared/lib/format';
import { cn } from '@/lib/utils';

interface FormValues {
  officialId: string;
  password: string;
  remember: boolean;
}

const FIELD =
  'flex h-14 w-full items-center gap-3 rounded-full border-2 border-slate-900/80 bg-white px-5 text-base text-slate-900 transition-colors focus-within:border-amber-500 focus-within:ring-4 focus-within:ring-amber-300/40';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);

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
    setDemoOpen(false);
  };

  const fieldError = errors.officialId?.message ?? errors.password?.message ?? null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-slate-900">
      {/* Watercolour wash across the top of the screen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[62vh] min-h-[420px]"
        style={{
          background:
            'radial-gradient(120% 70% at 15% 10%, #F7C531 0%, #F9D45C 38%, rgba(250, 222, 120, 0.85) 55%, rgba(253, 240, 190, 0.35) 72%, rgba(255,255,255,0) 86%),' +
            'radial-gradient(70% 55% at 85% 35%, rgba(247, 197, 49, 0.9) 0%, rgba(249, 212, 92, 0.6) 40%, rgba(255,255,255,0) 75%),' +
            'radial-gradient(60% 45% at 30% 70%, rgba(249, 212, 92, 0.55) 0%, rgba(255,255,255,0) 70%)',
          maskImage:
            'radial-gradient(140% 100% at 50% -10%, #000 55%, rgba(0,0,0,0.6) 72%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(140% 100% at 50% -10%, #000 55%, rgba(0,0,0,0.6) 72%, transparent 100%)',
        }}
      />

      <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-10 sm:pt-14">
        <Link to="/login" className="mx-auto block w-56 sm:w-64" aria-label="LMPC sign in">
          <BrandLogo className="h-auto w-full" />
        </Link>

        <h1
          className="mt-10 text-center text-5xl font-extrabold tracking-tight text-slate-900 sm:mt-12"
          style={{ fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif" }}
        >
          Sign In
        </h1>

        <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
          <label className={cn(FIELD, errors.officialId && 'border-red-600')}>
            <IdCard size={22} className="shrink-0 text-slate-900" aria-hidden />
            <input
              id="officialId"
              autoComplete="username"
              placeholder="Official ID or Email ID"
              aria-label="Official ID or Email ID"
              aria-invalid={!!errors.officialId}
              className="h-full w-full bg-transparent placeholder:text-slate-500 focus:outline-none"
              {...register('officialId', { required: 'Enter your Official ID or Email ID' })}
            />
          </label>

          <label className={cn(FIELD, errors.password && 'border-red-600')}>
            <KeyRound size={22} className="shrink-0 text-slate-900" aria-hidden />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Password"
              aria-label="Password"
              aria-invalid={!!errors.password}
              className="h-full w-full bg-transparent placeholder:text-slate-500 focus:outline-none"
              {...register('password', { required: 'Enter your password' })}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="shrink-0 rounded-full p-1 text-slate-500 transition-colors hover:text-slate-800"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </label>

          {(fieldError || formError) && (
            <p role="alert" className="flex items-start justify-center gap-1.5 text-center text-sm font-medium text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {formError ?? fieldError}
            </p>
          )}

          <div className="flex items-center justify-between px-1 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-400 text-amber-500 focus:ring-amber-400"
                {...register('remember')}
              />
              Remember me
            </label>
            <button
              type="button"
              onClick={() =>
                toast.info('Password reset', 'Password resets are handled by the department administrator.')
              }
              className="text-base font-bold text-slate-900 underline underline-offset-4 hover:text-amber-700"
            >
              Forgot Password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mx-auto mt-2 flex h-16 w-full max-w-[26rem] items-center justify-center rounded-full bg-[#F6C21B] text-lg font-semibold uppercase tracking-[0.18em] text-slate-900 shadow-[0_10px_30px_-10px_rgba(246,194,27,0.8)] transition-transform hover:brightness-95 active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
          >
            {isSubmitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-slate-700">
          New to the department?{' '}
          <Link to="/register" className="font-bold text-slate-900 underline underline-offset-4 hover:text-amber-700">
            Request access
          </Link>
        </p>

        {/* Demonstration accounts, folded away so the screen stays clean */}
        <div className="mt-auto pt-10">
          <button
            type="button"
            onClick={() => setDemoOpen((o) => !o)}
            className="mx-auto flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-800"
            aria-expanded={demoOpen}
          >
            Demonstration accounts
            <ChevronDown size={14} className={cn('transition-transform', demoOpen && 'rotate-180')} />
          </button>
          {demoOpen && (
            <div className="mt-3 space-y-1.5">
              {DEMO_CREDENTIALS.map((c) => {
                const account = USERS.find((u) => u.officialId === c.officialId)!;
                return (
                  <button
                    key={c.officialId}
                    type="button"
                    onClick={() => fillDemo(c.officialId, c.password)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-amber-400 hover:bg-amber-50"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                      {account.avatarInitials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">
                        {ROLE_LABEL[c.role]} · {account.name}
                      </span>
                      <span className="block truncate font-mono text-xs text-slate-500">
                        {c.officialId} / {c.password}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-bold text-amber-700">Use</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
