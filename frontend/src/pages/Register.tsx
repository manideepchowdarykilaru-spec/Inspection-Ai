import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { requestAccess } from '@/services/authService';
import { REGIONS } from '@shared/data/mockData';

interface FormValues {
  name: string;
  officialId: string;
  email: string;
  phone: string;
  designation: string;
  region: string;
  role: 'INSPECTOR' | 'SUPERVISOR';
  password: string;
  confirm: string;
}

/**
 * Access request.
 *
 * Officers are provisioned by the department, never self-registered, so this
 * form creates a PENDING account that an administrator approves in User
 * Management. In production the identity itself would come from the state
 * HRMS or NIC Parichay single sign-on; the approval step is what remains.
 */
export default function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ name: string; officialId: string } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { role: 'INSPECTOR', region: REGIONS[0] ?? '', designation: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await requestAccess({
        name: values.name,
        officialId: values.officialId,
        email: values.email,
        phone: values.phone,
        designation: values.designation,
        region: values.region,
        role: values.role,
        password: values.password,
      });
      setSubmitted({ name: values.name, officialId: values.officialId.toUpperCase() });
      toast.success('Access request submitted', 'The department administrator has been notified.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The request could not be submitted.');
    }
  });

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <Link to="/login" className="mx-auto mb-6 block w-44" aria-label="Back to sign in">
          <BrandLogo className="h-auto w-full" />
        </Link>

        {submitted ? (
          <div className="surface p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">Request submitted</h1>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  Thank you, {submitted.name}. Your request for official ID{' '}
                  <span className="font-mono font-semibold text-slate-800">{submitted.officialId}</span> has been
                  sent to the department administrator. You will be able to sign in once it is approved.
                </p>
                <ol className="mt-4 space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  <li>1. The administrator verifies your identity against departmental records.</li>
                  <li>2. Your role and jurisdiction are confirmed or adjusted.</li>
                  <li>3. The account is activated and you sign in with the password you chose.</li>
                </ol>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button onClick={() => navigate('/login')}>Go to sign in</Button>
                  <Button variant="outline" onClick={() => setSubmitted(null)}>
                    Submit another request
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="surface p-6 sm:p-8">
            <h1 className="text-lg font-bold tracking-tight text-slate-900">Request access</h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              For officers of the Legal Metrology department. Your account is created in a pending state and
              activated by the department administrator after verification.
            </p>

            {formError && (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-600" />
                <p className="text-xs leading-relaxed text-red-800">{formError}</p>
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-5 grid gap-4 sm:grid-cols-2" noValidate>
              <Field label="Full name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-2">
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="As on your departmental ID card"
                  {...register('name', { required: 'Full name is required', minLength: { value: 3, message: 'Enter your full name' } })}
                />
              </Field>

              <Field
                label="Official / employee ID"
                htmlFor="officialId"
                required
                hint="Your HRMS employee ID or departmental official ID"
                error={errors.officialId?.message}
              >
                <Input
                  id="officialId"
                  autoComplete="username"
                  placeholder="LM-TS-INS-2101"
                  className="font-mono uppercase"
                  {...register('officialId', {
                    required: 'Official ID is required',
                    pattern: { value: /^[A-Za-z0-9][A-Za-z0-9\-\/.]{3,31}$/, message: 'Letters, digits, - and / only' },
                  })}
                />
              </Field>

              <Field label="Official e-mail" htmlFor="email" required error={errors.email?.message}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@lm.telangana.gov.in"
                  {...register('email', {
                    required: 'E-mail is required',
                    pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid e-mail address' },
                  })}
                />
              </Field>

              <Field label="Mobile number" htmlFor="phone" required hint="Used for OTP verification" error={errors.phone?.message}>
                <Input
                  id="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  {...register('phone', {
                    required: 'Mobile number is required',
                    validate: (v) => v.replace(/\D/g, '').length >= 10 || 'Enter a 10-digit mobile number',
                  })}
                />
              </Field>

              <Field label="Role requested" htmlFor="role" required>
                <Select id="role" {...register('role')}>
                  <option value="INSPECTOR">Inspector of Legal Metrology</option>
                  <option value="SUPERVISOR">Supervisor / Assistant Controller</option>
                </Select>
              </Field>

              <Field label="Region / jurisdiction" htmlFor="region" required>
                <Select id="region" {...register('region')}>
                  {REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value="State Headquarters">State Headquarters</option>
                </Select>
              </Field>

              <Field label="Designation" htmlFor="designation" hint="Optional; defaults from the role">
                <Input id="designation" placeholder="Inspector of Legal Metrology" {...register('designation')} />
              </Field>

              <Field label="Password" htmlFor="password" required error={errors.password?.message}>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="pr-10"
                    {...register('password', {
                      required: 'Choose a password',
                      minLength: { value: 8, message: 'At least 8 characters' },
                    })}
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

              <Field label="Confirm password" htmlFor="confirm" required error={errors.confirm?.message}>
                <Input
                  id="confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  {...register('confirm', {
                    required: 'Re-enter the password',
                    validate: (v) => v === watch('password') || 'Passwords do not match',
                  })}
                />
              </Field>

              <div className="sm:col-span-2 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                <ShieldCheck size={13} className="mt-0.5 shrink-0 text-slate-500" />
                <p className="text-2xs leading-relaxed text-slate-600">
                  By requesting access you confirm that you are an officer of the department. Requests are
                  verified against departmental records before activation, and all actions in the system are
                  recorded against your official identity.
                </p>
              </div>

              <div className="sm:col-span-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Link to="/login" className="text-xs font-semibold text-brand-700 hover:underline">
                  Already have an account? Sign in
                </Link>
                <Button type="submit" size="lg" loading={isSubmitting} className="justify-center">
                  {isSubmitting ? 'Submitting…' : 'Submit access request'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
