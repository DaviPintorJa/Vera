"use client"

import { useState } from "react"
import { createClient } from "@/lib/llm/supabase/client"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const supabase = createClient()
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [mode, setMode] = useState<"login" | "signup">("login")

  async function handleSignup() {
    setIsLoading(true)
    setMessage("")
    const { error } = await supabase.auth.signUp({ email, password })
    setIsLoading(false)
    if (error) { setMessage(error.message); return }
    setMessage("Conta criada! Verifique seu e-mail e entre.")
  }

  async function handleLogin() {
    setIsLoading(true)
    setMessage("")
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setIsLoading(false)
    if (error) { setMessage(error.message); return }
    router.push("/chat")
  }

  const handleSubmit = () => mode === "login" ? handleLogin() : handleSignup()

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit()
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .login-root {
          min-height: 100vh;
          background: #07070d;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'DM Sans', sans-serif;
          position: relative;
          overflow: hidden;
        }

        .bg-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(99,102,241,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%);
        }

        .glow {
          position: absolute;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
        }

        .card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 400px;
          padding: 48px 40px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(99,102,241,0.15);
          border-radius: 20px;
          backdrop-filter: blur(12px);
          box-shadow:
            0 0 0 1px rgba(99,102,241,0.05),
            0 32px 64px rgba(0,0,0,0.5),
            inset 0 1px 0 rgba(255,255,255,0.04);
        }

        .logo-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 32px;
        }

        .logo-icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Space Mono', monospace;
          font-weight: 700;
          color: white;
          font-size: 16px;
          box-shadow: 0 4px 16px rgba(99,102,241,0.4);
        }

        .logo-name {
          font-family: 'Space Mono', monospace;
          font-size: 18px;
          font-weight: 700;
          color: #e2e2f0;
          letter-spacing: 0.1em;
        }

        .logo-tag {
          font-size: 11px;
          color: #6366f1;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .heading {
          font-size: 22px;
          font-weight: 500;
          color: #e2e2f0;
          margin-bottom: 6px;
          line-height: 1.3;
        }

        .subheading {
          font-size: 13px;
          color: #555570;
          margin-bottom: 28px;
          font-weight: 300;
        }

        .tab-row {
          display: flex;
          gap: 4px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(99,102,241,0.1);
          border-radius: 10px;
          padding: 4px;
          margin-bottom: 24px;
        }

        .tab {
          flex: 1;
          padding: 8px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: #555570;
          font-size: 13px;
          font-family: 'DM Sans', sans-serif;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.18s ease;
          letter-spacing: 0.02em;
        }

        .tab.active {
          background: rgba(99,102,241,0.18);
          color: #a5b4fc;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        .field {
          margin-bottom: 14px;
        }

        .field label {
          display: block;
          font-size: 11px;
          font-weight: 500;
          color: #555570;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 7px;
        }

        .field input {
          width: 100%;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(99,102,241,0.12);
          border-radius: 10px;
          padding: 12px 14px;
          color: #e2e2f0;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          outline: none;
          transition: border-color 0.18s ease, box-shadow 0.18s ease;
        }

        .field input:focus {
          border-color: rgba(99,102,241,0.45);
          box-shadow: 0 0 0 3px rgba(99,102,241,0.08);
        }

        .field input::placeholder { color: #33334a; }

        .submit-btn {
          width: 100%;
          margin-top: 8px;
          padding: 13px;
          background: linear-gradient(135deg, #6366f1 0%, #7c3aed 100%);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          font-weight: 500;
          cursor: pointer;
          letter-spacing: 0.03em;
          transition: opacity 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease;
          box-shadow: 0 4px 16px rgba(99,102,241,0.35);
        }

        .submit-btn:hover:not(:disabled) {
          opacity: 0.92;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(99,102,241,0.45);
        }

        .submit-btn:active:not(:disabled) { transform: translateY(0); }

        .submit-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .msg {
          margin-top: 14px;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          color: #a5b4fc;
          background: rgba(99,102,241,0.08);
          border: 1px solid rgba(99,102,241,0.15);
          line-height: 1.4;
        }

        .msg.error {
          color: #f87171;
          background: rgba(239,68,68,0.07);
          border-color: rgba(239,68,68,0.15);
        }

        .footer-note {
          margin-top: 24px;
          font-size: 11px;
          color: #33334a;
          text-align: center;
          line-height: 1.5;
        }
      `}</style>

      <div className="login-root">
        <div className="bg-grid" />
        <div className="glow" />

        <div className="card">
          <div className="logo-row">
            <div className="logo-icon">V</div>
            <div>
              <div className="logo-name">VERA</div>
              <div className="logo-tag">Assistente de projetos</div>
            </div>
          </div>

          <div className="heading">
            {mode === "login" ? "Bem-vindo de volta" : "Criar conta"}
          </div>
          <div className="subheading">
            {mode === "login"
              ? "Entre para continuar seus projetos"
              : "Crie sua conta e comece agora"}
          </div>

          <div className="tab-row">
            <button
              className={`tab ${mode === "login" ? "active" : ""}`}
              onClick={() => { setMode("login"); setMessage("") }}
            >
              Entrar
            </button>
            <button
              className={`tab ${mode === "signup" ? "active" : ""}`}
              onClick={() => { setMode("signup"); setMessage("") }}
            >
              Criar conta
            </button>
          </div>

          <div className="field">
            <label>E-mail</label>
            <input
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label>Senha</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          <button
            className="submit-btn"
            onClick={handleSubmit}
            disabled={isLoading || !email || !password}
          >
            {isLoading
              ? "Aguarde..."
              : mode === "login" ? "Entrar" : "Criar conta"}
          </button>

          {message && (
            <div className={`msg ${message.toLowerCase().includes("erro") || message.toLowerCase().includes("invalid") || message.toLowerCase().includes("wrong") ? "error" : ""}`}>
              {message}
            </div>
          )}

          <div className="footer-note">
            Ao entrar, o senhor concorda com os termos de uso da VERA.
          </div>
        </div>
      </div>
    </>
  )
}