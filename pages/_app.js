import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import "../styles/global.css";
import { supabase } from "../lib/supabaseClient";

export default function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    const publicPaths = ["/login"];
    const isPublicRoute = publicPaths.includes(router.pathname);

    async function checkAccess() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session && !isPublicRoute) {
        router.replace("/login");
        setAuthChecked(true);
        return;
      }

      if (session && router.pathname === "/login") {
        router.replace("/assets");
        setAuthChecked(true);
        return;
      }

      setAuthChecked(true);
    }

    checkAccess();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && !isPublicRoute) {
        router.replace("/login");
      }
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [router.pathname]);

  if (!authChecked) {
    return null;
  }

  return <Component {...pageProps} />;
}
