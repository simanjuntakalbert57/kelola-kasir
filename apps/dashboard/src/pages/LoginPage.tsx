import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, Field, NoticeCard } from '../components/ui';
import { ApiError } from '../lib/api';

const schema = z.object({
  email: z.email('Email tidak valid.'),
  password: z.string().min(8, 'Kata sandi minimal 8 karakter.'),
});
type Values = z.infer<typeof schema>;

function loginErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Email atau kata sandi salah. Coba cek lagi ya.';
    if (error.status === 429) return 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';
  }
  return 'Belum bisa masuk. Cek sinyal lalu coba lagi.';
}

export function LoginPage() {
  const { login } = useAuth();
  const [show, setShow] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      await login(email, password);
    } catch (e) {
      setFormError(loginErrorText(e));
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section
        aria-hidden="true"
        className="hidden flex-col justify-center gap-4 bg-[image:var(--gradient-hero)] p-16 text-white lg:flex"
      >
        <div className="text-7xl">🍹</div>
        <p className="max-w-md text-4xl leading-tight font-black">Jualan hari ini, sekali buka.</p>
        <p className="max-w-md text-lg font-semibold text-white/90">
          Omzet, shift, dan persetujuan batal. Semua ada di sini, dari HP maupun laptop.
        </p>
      </section>
      <div className="flex flex-col items-center justify-center gap-4 p-4">
        <div className="text-5xl lg:hidden" aria-hidden="true">
          🍹
        </div>
        <Card className="w-full max-w-105 p-6 sm:p-8">
          <h1 className="text-2xl">Selamat datang, Pak 👋</h1>
          <p className="mb-5 text-muted">Masuk dulu buat lihat hasil jualan.</p>
          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            {formError ? (
              <div role="alert">
                <NoticeCard kind="action">{formError}</NoticeCard>
              </div>
            ) : null}
            <Field
              label="Email"
              type="email"
              autoComplete="username"
              error={errors.email?.message}
              {...register('email')}
            />
            <Field
              label="Kata sandi"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              hint="Minimal 8 karakter."
              error={errors.password?.message}
              trailing={
                <button
                  type="button"
                  aria-label={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                  aria-pressed={show}
                  onClick={() => setShow((v) => !v)}
                  className="grid size-11 place-items-center rounded-full text-muted hover:bg-bg"
                >
                  {show ? (
                    <EyeOff size={20} aria-hidden="true" />
                  ) : (
                    <Eye size={20} aria-hidden="true" />
                  )}
                </button>
              }
              {...register('password')}
            />
            <Button type="submit" variant="primary" className="mt-2 w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Memeriksa…' : 'Masuk'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted">
            Lupa kata sandi? Hubungi pengelola sistem.
          </p>
        </Card>
      </div>
    </div>
  );
}
