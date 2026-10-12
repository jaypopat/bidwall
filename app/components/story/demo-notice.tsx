"use client";

import { useEffect, useRef } from "react";

const SEEN = "bidwall-demo-notice-v1";
const REPO = "https://github.com/jaypopat/bidwall";

/** Explain the hosted recording once per tab; native dialog supplies focus and Escape handling. */
export function DemoNotice({ hosted }: { hosted: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    if (!hosted || shown.current) return;
    shown.current = true;
    try {
      if (sessionStorage.getItem(SEEN)) return;
    } catch {
      // Storage is optional; the notice still works in restricted browsers.
    }
    dialog.current?.showModal();
  }, [hosted]);

  const remember = () => {
    try {
      sessionStorage.setItem(SEEN, "1");
    } catch {}
  };

  return (
    <>
      <button
        className="demo-info"
        aria-haspopup="dialog"
        aria-label="About this demo"
        onClick={() => dialog.current?.showModal()}
      >
        Demo info
      </button>
      <dialog
        ref={dialog}
        className="demo-notice"
        aria-labelledby="demo-notice-title"
        aria-describedby="demo-notice-description"
        onClose={remember}
      >
        <button
          className="notice-close"
          aria-label="Close demo notice"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
        <span className="kicker">Local execution · test funds</span>
        <h2 id="demo-notice-title">A recorded run you can reproduce.</h2>
        <p id="demo-notice-description">
          This site shows a verified local replay of captured Solana mainnet
          state, using Kamino&apos;s actual program and test funds. To execute
          the scenario yourself, run it locally.
        </p>
        <p className="notice-limit">
          Bidwall contracts are not deployed to a public network. The live
          Jupiter quote button only requests prices.
        </p>
        <details className="notice-setup">
          <summary>Run it yourself</summary>
          <p>
            Install the{" "}
            <a
              href={`${REPO}/blob/main/docs/TOOLCHAIN.md`}
              target="_blank"
              rel="noreferrer"
            >
              toolchain and Surfpool
            </a>
            , then:
          </p>
          <pre>
            <code>{`git clone ${REPO}.git
cd bidwall
pnpm install --frozen-lockfile --ignore-scripts
npm run dev:demo`}</code>
          </pre>
          <p>
            Open localhost:3000 and click <strong>Run ONyc scenario</strong>.
            The runner starts its own local runtime and checks every payment.
          </p>
        </details>
        <div className="notice-actions">
          <button
            className="btn-primary"
            onClick={() => dialog.current?.close()}
          >
            Explore the demo <span aria-hidden>→</span>
          </button>
          <a href={REPO} target="_blank" rel="noreferrer">
            View source ↗
          </a>
        </div>
      </dialog>
    </>
  );
}
