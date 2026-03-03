import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabaseClient';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    async function redirectBySession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        router.replace('/assets');
      } else {
        router.replace('/login');
      }
    }

    redirectBySession();
  }, [router]);

  return null;
}
