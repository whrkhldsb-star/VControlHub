import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Toolbar, StatCard, EmptyState } from "@/components/page-shell";
import { FormField, IconButton, Notice, SegmentedTabs } from "@/components/ui-primitives";
import { StatusBadge } from "@/components/status-badge";
import { Pagination } from "@/components/pagination";
import { ModalShell } from "@/components/modal-shell";
import { Folder, Plus, RefreshCw, X } from "@/components/icons";
import { I18nProvider } from "@/lib/i18n/provider";
import { UI_INPUT } from "@/lib/ui/classes";

function Showcase() {
  const [theme, setTheme] = useState("dark");
  const [tab, setTab] = useState("controls");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 16px" }}>
    <PageHeader title="VControlHub UI" eyebrow="Component reference">
      <select aria-label="Theme" className={UI_INPUT} value={theme} onChange={(event) => {
        setTheme(event.target.value); document.documentElement.classList.toggle("light", event.target.value === "light");
      }}><option value="dark">Dark</option><option value="light">Light</option></select>
    </PageHeader>
    <SegmentedTabs ariaLabel="Examples" value={tab} onChange={setTab} items={[
      { id: "controls", label: "Controls", tabId: "controls-tab", panelId: "sample-panel" },
      { id: "states", label: "States", tabId: "states-tab", panelId: "sample-panel" },
    ]} />
    <section id="sample-panel" role="tabpanel" aria-labelledby={`${tab}-tab`} style={{ paddingTop: 24, display: "grid", gap: 24 }}>
      {tab === "controls" ? <>
        <Toolbar>
          <ActionButton onClick={() => setOpen(true)}><Plus size={18} aria-hidden />Create node</ActionButton>
          <ActionButton variant="secondary" onClick={() => setSaved(true)}>Save changes</ActionButton>
          <ActionButton variant="danger" disabled>Delete</ActionButton>
          <IconButton label="Refresh" onClick={() => setSaved(false)}><RefreshCw size={18} aria-hidden /></IconButton>
        </Toolbar>
        {saved && <Notice tone="success">Changes saved</Notice>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 16 }}>
          <StatCard label="Nodes" value={128} />
          <StatCard label="Healthy" value={124} accent accentColor="emerald" />
          <StatCard label="Pending" value={4} accent accentColor="amber" />
        </div>
        <FormField label="Node name" htmlFor="sample-name"><input id="sample-name" className={UI_INPUT} defaultValue="production-api-01" /></FormField>
        <FormField label="Host" htmlFor="sample-host" error="A host is required"><input id="sample-host" className={UI_INPUT} data-input data-error="true" /></FormField>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge tone="success">Online</StatusBadge><StatusBadge tone="warning">Pending</StatusBadge><StatusBadge tone="danger">Unavailable</StatusBadge>
        </div>
        <Pagination page={page} pageSize={25} totalItems={128} onPageChange={setPage} />
      </> : <>
        <Notice tone="warning" title="Partial completion">2 of 12 files could not be synchronized.</Notice>
        <Notice tone="danger" title="Connection failed" action={{ label: "Retry", onClick: () => setSaved(true) }}>{saved ? "Retry requested" : "The node did not respond."}</Notice>
        <EmptyState text="No matching files" icon={<Folder size={24} />} />
      </>}
    </section>
    <ModalShell open={open} onClose={() => setOpen(false)} labelledBy="sample-dialog-title" panelClassName="w-full max-w-lg border border-[var(--border)] bg-[var(--modal-bg)] p-4">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <h2 id="sample-dialog-title">Create node</h2><IconButton label="Close" onClick={() => setOpen(false)}><X size={18} aria-hidden /></IconButton>
      </div>
      <FormField label="Name" htmlFor="dialog-name"><input id="dialog-name" className={UI_INPUT} /></FormField>
      <ActionButton onClick={() => { setOpen(false); setSaved(true); }}>Create</ActionButton>
    </ModalShell>
  </main>;
}

createRoot(document.getElementById("root")!).render(<I18nProvider initialLocale="en"><Showcase /></I18nProvider>);
