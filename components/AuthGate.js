"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function AuthGate({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const sb = useRef(null);
  const [user, setUser] = useState(null);
  const isLogin = pathname === "/login";
  const configured = Boolean(URL_ && KEY_);

  useEffect(() => {
    if (isLogin || !configured) return;
    const client = createClient(URL_, KEY_);
    sb.current = client;

    client.auth.getSession().then(({ data }) => {
      if (data.session) setUser(data.session.user);
      else router.replace("/login");
    });
    const { data: sub } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [isLogin, configured, router]);

  if (isLogin) return children;

  if (!configured) {
    return (
      <p style={{ padding: 24, font: "16px system-ui", color: "#f5b544" }}>
        Supabase is not connected. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the dev server.
      </p>
    );
  }

  if (!user) return null;

  const meta = user.user_metadata || {};
  const name = meta.full_name || meta.name || user.email;

  return (
    <>
      {children}
      <div
        style={{
          position: "fixed", top: 12, right: 12, zIndex: 1000,
          display: "flex", alignItems: "center", gap: 10,
          padding: "6px 8px 6px 12px", borderRadius: 999,
          background: "#1d1a40", border: "1px solid #34305f",
          color: "#ece9ff", font: "500 13px system-ui, sans-serif",
        }}
      >
        {meta.avatar_url && (
          <img src={meta.avatar_url} alt="" width={22} height={22} referrerPolicy="no-referrer" style={{ borderRadius: "50%" }} />
        )}
        <span>{name}</span>
        <button
          onClick={() => sb.current?.auth.signOut()}
          style={{
            border: 0, borderRadius: 999, padding: "5px 12px", cursor: "pointer",
            background: "#f5b544", color: "#14112e", font: "600 12px system-ui, sans-serif",
          }}
        >
          Sign out
        </button>
      </div>
    </>
  );
}
