import type { ReactNode } from "react";
import { AssistantDrawer } from "@/app/components/AssistantDrawer";
import { NavLoadingProvider } from "@/app/components/NavLoading";
import { ThemeToggle } from "@/app/components/ThemeToggle";

type NavKey = "overview" | "report";

function NavItem({
  href,
  title,
  icon,
  active,
  label,
}: {
  href: string;
  title: string;
  icon: string;
  active: boolean;
  label: string;
}) {
  return (
    <a
      className={`nav-item${active ? " active" : ""}`}
      href={href}
      title={title}
      aria-label={title}
      aria-current={active ? "page" : undefined}
    >
      <span className={active ? "msf" : "ms"}>{icon}</span>
      <span className="nav-label">{label}</span>
    </a>
  );
}

export function Shell({
  active,
  title,
  crumb,
  updatedText,
  windowLabel,
  toolbar,
  children,
  assistant,
}: {
  active: NavKey;
  title: string;
  crumb: string;
  updatedText: string;
  windowLabel: string;
  toolbar?: ReactNode;
  children: ReactNode;
  assistant?: ReactNode;
}) {
  return (
    <div className="app-shell">
      <nav className="nav-rail" aria-label="Primary">
        <div className="nav-brand" aria-hidden="true">
          <i className="b1" />
          <i className="b2" />
        </div>
        <NavItem href="/" title="Dashboard" icon="space_dashboard" active={active === "overview"} label="Dashboard" />
        <NavItem href="/report" title="Statistics" icon="monitoring" active={active === "report"} label="Statistics" />
        <div className="nav-spacer" />
        <a className="nav-item" href="#" title="Settings" aria-label="Settings">
          <span className="ms">settings</span>
          <span className="nav-label">Settings</span>
        </a>
        <div className="nav-avatar" title="Group 6 operator">G6</div>
      </nav>

      <main className="main">
        <NavLoadingProvider>
        <header className="topbar">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="crumbs">
              <span>NextAI</span>
              <span className="sep">/</span>
              <span>Workspace</span>
              <span className="sep">/</span>
              <span className="here">{crumb}</span>
            </div>
            <div className="title-row">
              <h1 className="page-title">{title}</h1>
              <span className="env-pill">
                <span className="kpi-dot" style={{ background: "var(--good)" }} />
                Live billing data
              </span>
            </div>
            <div className="freshness">
              <span className="ms" style={{ fontSize: 14 }}>schedule</span>
              <span>{updatedText}</span>
              <span style={{ opacity: 0.5 }}>&middot;</span>
              <span>{windowLabel}</span>
            </div>
          </div>
          <div className="top-actions">
            <ThemeToggle />
            <a className="icon-btn" href="/api/group6/usage" title="View raw usage JSON" target="_blank" rel="noreferrer">
              <span className="ms">data_object</span>
            </a>
            <a className="btn" href="/report#export">
              <span className="ms">ios_share</span>
              Export
            </a>
          </div>
        </header>

        {toolbar ? <div className="toolbar">{toolbar}</div> : null}

        <div className="body">
          <div className="scroll">
            <div className="page">{children}</div>
          </div>
        </div>
        </NavLoadingProvider>
      </main>
      {assistant ? <AssistantDrawer>{assistant}</AssistantDrawer> : null}
    </div>
  );
}
