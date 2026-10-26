import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Button, Card, Field } from '../components/ui';
import { ApiError } from '../lib/api';

const schema = z.object({
  email: z.email('Email tidak valid.'),
  password: z.string().min(8, 'Kata sandi minimal 8 karakter.'),
});
type Values = z.infer<typeof schema>;

function loginErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Email atau kata sandi salah.';
    if (error.status === 429) return 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.';
  }
  return 'Tidak dapat masuk. Periksa koneksi lalu coba lagi.';
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
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-3 text-xl">Masuk Owner</h1>
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          {formError ? <Alert>{formError}</Alert> : null}
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
            error={errors.password?.message}
            {...register('password')}
          />
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Tampilkan kata sandi
          </label>
          <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Memproses…' : 'Masuk'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
