"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import "../gitscope.css";
import "./login.css";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const GITHUB = process.env.NEXT_PUBLIC_GITHUB_LOGIN === "true";
const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_LOGIN === "true";

const PATH = [
  "Map the architecture",
  "Run it on your machine",
  "Pick an issue that fits your level",
  "Open your first pull request",
];

export default function LoginPage() {
  const router = useRouter();
  const sb = useRef(null);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const configured = Boolean(URL_ && KEY_);
  const signup = mode === "signup";

  useEffect(() => {
    if (!configured) return;
    const client = createClient(URL_, KEY_);
    sb.current = client;
    client.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) router.replace("/");
    });
    return () => sub.subscription.unsubscribe();
  }, [configured, router]);

  async function submit(e) {
    e.preventDefault();
    if (!sb.current) return;
    setBusy(true);
    setError("");
    setNotice("");
    const creds = { email: email.trim(), password };
    const { data, error: err } = signup
      ? await sb.current.auth.signUp(creds)
      : await sb.current.auth.signInWithPassword(creds);
    if (err) {
      setError(err.message);
    } else if (signup && !data.session) {
      setNotice("Account created. Check your email to confirm it, then sign in.");
      setMode("signin");
    }
    setBusy(false);
  }

  async function oauth(provider) {
    if (!sb.current) return;
    setError("");
    const { error: err } = await sb.current.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + "/login" },
    });
    if (err) setError(err.message);
  }

  return (
    <main className="lg-page">
      <section className="lg-intro">
        <h1 className="lg-title">From an unfamiliar repo to your first contribution.</h1>
        <ol className="lg-path">
          {PATH.map((step, i) => (
            <li key={step} style={{ "--i": i }}>
              <span className="lg-dot" aria-hidden="true">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section className="lg-card" aria-labelledby="lg-head">
        <h2 id="lg-head">{signup ? "Create your account" : "Sign in to GitScope"}</h2>
        <p className="lg-sub">
          {signup ? "Use any email and a password of 6 or more characters." : "Welcome back. Enter your email and password."}
        </p>

        {!configured ? (
          <p className="lg-error" role="alert">
            Supabase is not connected. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the dev server.
          </p>
        ) : (
          <>
            <form className="lg-form" onSubmit={submit}>
              <label className="lg-field">
                Email
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="lg-field">
                Password
                <input
                  type="password" required minLength={6}
                  autoComplete={signup ? "new-password" : "current-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="lg-btn" type="submit" disabled={busy}>
                {busy ? "Please wait..." : signup ? "Create account" : "Sign in"}
              </button>
            </form>

            {GOOGLE && (
              <button className="lg-alt" type="button" onClick={() => oauth("google")}>
                Continue with Google
              </button>
            )}
            {GITHUB && (
              <button className="lg-alt" type="button" onClick={() => oauth("github")}>
                Continue with GitHub
              </button>
            )}

            <button
              className="lg-switch" type="button"
              onClick={() => { setMode(signup ? "signin" : "signup"); setError(""); setNotice(""); }}
            >
              {signup ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
          </>
        )}

        {notice && <p className="lg-notice" role="status">{notice}</p>}
        {error && <p className="lg-error" role="alert">{error}</p>}
        <p className="lg-foot">GitScope reads public repository data only.</p>
      </section>
    </main>
  );
}
