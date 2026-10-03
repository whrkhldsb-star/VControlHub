/**
 * Living reference for the shared UI system (docs/ui-system.md).
 *
 * `npm run ui:showcase` bundles this file with the real components and the
 * real globals.css into a standalone page; `npm run ui:check` then verifies
 * every state in both themes at 320/768/1440px (layout overflow, axe WCAG AA,
 * runtime errors). Change a token or a component, rebuild, and every variant
 * is on one page.
 */
import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Download, Folder, Plus, RefreshCw, Settings, Trash2 } from "@/components/icons";
import { IconExternalLink, IconMore } from "@/components/nav-icons";
import {
	Card,
	EmptyState,
	ListPanel,
	ListRow,
	MetricPanel,
	PageHeader,
	StatCard,
	StatGrid,
	Toolbar,
} from "@/components/page-shell";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/status-badge";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { KeyValueList } from "@/components/ui/key-value";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import {
	Badge,
	FormField,
	IconButton,
	Notice,
	ProgressBar,
	SegmentedTabs,
	Spinner,
	Switch,
} from "@/components/ui-primitives";
import { I18nProvider } from "@/lib/i18n/provider";
import { UI_INPUT } from "@/lib/ui/classes";

function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section style={{ display: "grid", gap: 12 }}>
			<h2 className="text-[13px] font-medium text-[var(--text-muted)]">{title}</h2>
			{children}
		</section>
	);
}

function Row({ children }: { children: ReactNode }) {
	return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>{children}</div>;
}

const VARIANTS = ["primary", "secondary", "outline", "ghost", "success", "warning", "danger", "danger-solid"] as const;

function Controls({ onCreate, onDelete }: { onCreate: () => void; onDelete: () => void }) {
	const [page, setPage] = useState(1);
	const [enabled, setEnabled] = useState(true);
	const [range, setRange] = useState("24h");
	const [busy, setBusy] = useState(false);
	return (
		<>
			<Group title="Buttons — variants">
				<Row>
					{VARIANTS.map((variant) => (
						<ActionButton key={variant} variant={variant}>
							{variant}
						</ActionButton>
					))}
				</Row>
			</Group>
			<Group title="Buttons — sizes, icons, loading, square, links">
				<Row>
					<ActionButton size="xs" variant="secondary">xs</ActionButton>
					<ActionButton size="sm" variant="secondary">sm</ActionButton>
					<ActionButton variant="secondary">md</ActionButton>
					<ActionButton size="lg" variant="secondary">lg</ActionButton>
					<ActionButton icon={<Plus size={16} aria-hidden />} onClick={onCreate}>Create node</ActionButton>
					<ActionButton variant="secondary" icon={<RefreshCw size={16} aria-hidden />} loading={busy} onClick={() => setBusy(true)}>
						{busy ? "Refreshing…" : "Refresh"}
					</ActionButton>
					<ActionButton variant="secondary" square aria-label="Download"><Download size={16} aria-hidden /></ActionButton>
					<ActionButton size="sm" variant="ghost" square aria-label="Settings"><Settings size={16} aria-hidden /></ActionButton>
					<ButtonLink href="https://example.com/docs" external variant="ghost" iconRight={<IconExternalLink size={14} />}>Docs</ButtonLink>
					<ActionButton variant="danger" icon={<Trash2 size={16} aria-hidden />} onClick={onDelete}>Delete</ActionButton>
					<ActionButton disabled>Disabled</ActionButton>
				</Row>
			</Group>
			<Group title="Menu and toolbar">
				<Toolbar className="mb-0">
					<Menu label="More actions" trigger="More">
						<MenuLabel>Node</MenuLabel>
						<MenuItem onSelect={() => setBusy(false)}>Rename</MenuItem>
						<MenuItem onSelect={() => setBusy(false)} description="Copies metrics and tags">Duplicate</MenuItem>
						<MenuSeparator />
						<MenuItem danger onSelect={onDelete}>Delete</MenuItem>
					</Menu>
					<Menu label="Row actions" trigger={<IconMore size={16} />} caret={false} variant="ghost" align="start">
						<MenuItem onSelect={() => setBusy(false)}>Open</MenuItem>
						<MenuItem onSelect={() => setBusy(false)} disabled>Archive</MenuItem>
					</Menu>
					<IconButton label="Refresh list" onClick={() => setBusy(false)}><RefreshCw size={16} aria-hidden /></IconButton>
				</Toolbar>
			</Group>
			<Group title="Fields">
				<div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))" }}>
					<FormField label="Node name" htmlFor="sample-name"><input id="sample-name" className={UI_INPUT} defaultValue="production-api-01" /></FormField>
					<FormField label="Host" htmlFor="sample-host" error="A host is required"><input id="sample-host" className={UI_INPUT} data-input data-error="true" /></FormField>
					<FormField label="Region" htmlFor="sample-region">
						<select id="sample-region" className={UI_INPUT} defaultValue="hk"><option value="hk">Hong Kong</option><option value="fra">Frankfurt</option></select>
					</FormField>
				</div>
				<Row>
					<Switch checked={enabled} onCheckedChange={setEnabled} label="Alerts enabled" />
					<SegmentedTabs
						ariaLabel="Time range"
						variant="pills"
						value={range}
						onChange={setRange}
						items={[
							{ id: "1h", label: "1h", tabId: "range-1h", panelId: "range-panel" },
							{ id: "24h", label: "24h", tabId: "range-24h", panelId: "range-panel" },
							{ id: "7d", label: "7d", tabId: "range-7d", panelId: "range-panel" },
						]}
					/>
				</Row>
				<div id="range-panel" role="tabpanel" aria-labelledby={`range-${range}`} className="text-xs text-[var(--text-muted)]">Showing the last {range}</div>
			</Group>
			<Group title="Badges">
				<Row>
					<StatusBadge tone="success">Online</StatusBadge>
					<StatusBadge tone="warning">Pending</StatusBadge>
					<StatusBadge tone="danger">Unavailable</StatusBadge>
					<StatusBadge tone="info">Syncing</StatusBadge>
					<StatusBadge>Paused</StatusBadge>
					<Badge>in_app</Badge>
					<Badge tone="accent">Playbook ×2</Badge>
					<Badge tone="success">Webhook configured</Badge>
				</Row>
			</Group>
			<Pagination page={page} pageSize={25} totalItems={128} onPageChange={setPage} />
		</>
	);
}

function States({ onRetry, retried }: { onRetry: () => void; retried: boolean }) {
	return (
		<>
			<StatGrid cols={4} className="mb-0">
				<StatCard label="Nodes" value={128} />
				<StatCard label="Healthy" value={124} accent accentColor="emerald" />
				<StatCard label="Pending" value={4} accent accentColor="amber" />
				<StatCard label="Failed" value={0} />
			</StatGrid>
			<MetricPanel
				title="Fleet"
				metrics={[
					{ label: "CPU", value: "42%", detail: "avg over 24h" },
					{ label: "Memory", value: "61%", tone: "amber", detail: "3 nodes above 85%" },
					{ label: "Disk", value: "38%" },
					{ label: "Traffic", value: "1.2 TB", detail: "this month" },
				]}
			/>
			<div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))" }}>
				<Card
					title="hk-db-01"
					description="PostgreSQL primary · daily backups"
					actions={<StatusBadge tone="success">Online</StatusBadge>}
					footer={<><ActionButton size="sm" variant="secondary">Terminal</ActionButton><ActionButton size="sm">Open</ActionButton></>}
				>
					<KeyValueList
						columns={2}
						items={[
							{ label: "Host", value: "103.152.220.31", mono: true },
							{ label: "OS", value: "Ubuntu 24.04 LTS" },
							{ label: "Region", value: "Hong Kong" },
							{ label: "Tags", value: null },
						]}
					/>
				</Card>
				<Card title="Surfaces">
					<div style={{ display: "grid", gap: 8 }}>
						<div data-inset className="p-3 text-sm text-[var(--text-secondary)]">data-inset — a well inside a card</div>
						<div data-tile className="p-3 text-sm text-[var(--text-secondary)]">data-tile — a raised tile</div>
						<ProgressBar value={72} label="Disk usage" />
						<div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Spinner size="sm" label="Loading" /> Loading…</div>
					</div>
				</Card>
			</div>
			<ListPanel title="Recent tasks" count={3} actions={<ActionButton size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />}>Refresh</ActionButton>}>
				{["Backup hk-db-01", "Renew certificates", "Prune images"].map((name, index) => (
					<ListRow key={name} className="flex items-center justify-between gap-3">
						<span className="text-sm text-[var(--text-primary)]">{name}</span>
						<StatusBadge tone={index === 0 ? "info" : "success"}>{index === 0 ? "Running" : "Done"}</StatusBadge>
					</ListRow>
				))}
			</ListPanel>
			<Disclosure title="Migration tools" description="Export a backup and restore it on another server.">
				<div style={{ display: "grid", gap: 12 }}>
					<p className="text-sm text-[var(--text-secondary)]">Folded until needed — a native details element, so it works without JavaScript.</p>
					<Disclosure variant="inset" title="Show commands">
						<code className="ui-mono block rounded-md bg-[var(--surface-elevated)] p-3 text-xs text-[var(--text-secondary)]">bash deploy/backup.sh --type database</code>
					</Disclosure>
				</div>
			</Disclosure>
			<Notice tone="info" title="Maintenance window">hk-db-01 will be read-only from 02:00 to 04:00.</Notice>
			<Notice tone="warning" title="Partial completion">2 of 12 files could not be synchronized.</Notice>
			<Notice tone="danger" title="Connection failed" action={{ label: "Retry", onClick: onRetry }}>{retried ? "Retry requested" : "The node did not respond."}</Notice>
			<Notice tone="success">Changes saved</Notice>
			<EmptyState text="No matching files" icon={<Folder size={24} />} variant="boxed" />
		</>
	);
}

function Showcase() {
	const [theme, setTheme] = useState("dark");
	const [tab, setTab] = useState("controls");
	const [createOpen, setCreateOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [retried, setRetried] = useState(false);
	return (
		<main style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 24 }}>
			<PageHeader title="VControlHub UI" eyebrow="Component reference" description="Every shared component in both themes. Edit tokens.css or a component, rebuild, compare." className="mb-0">
				<select
					aria-label="Theme"
					className={UI_INPUT}
					value={theme}
					onChange={(event) => {
						setTheme(event.target.value);
						document.documentElement.classList.toggle("light", event.target.value === "light");
					}}
				>
					<option value="dark">Dark</option>
					<option value="light">Light</option>
				</select>
			</PageHeader>
			<SegmentedTabs
				ariaLabel="Examples"
				value={tab}
				onChange={setTab}
				items={[
					{ id: "controls", label: "Controls", tabId: "controls-tab", panelId: "sample-panel" },
					{ id: "states", label: "States", tabId: "states-tab", panelId: "sample-panel" },
				]}
			/>
			<section id="sample-panel" role="tabpanel" aria-labelledby={`${tab}-tab`} style={{ display: "grid", gap: 28 }}>
				{tab === "controls" ? (
					<Controls onCreate={() => setCreateOpen(true)} onDelete={() => setDeleteOpen(true)} />
				) : (
					<States onRetry={() => setRetried(true)} retried={retried} />
				)}
			</section>
			<Dialog
				open={createOpen}
				onClose={() => setCreateOpen(false)}
				title="Create node"
				description="Register a server so it can be monitored and managed."
				footer={
					<>
						<ActionButton variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</ActionButton>
						<ActionButton onClick={() => setCreateOpen(false)}>Create</ActionButton>
					</>
				}
			>
				<div style={{ display: "grid", gap: 16 }}>
					<FormField label="Name" htmlFor="dialog-name"><input id="dialog-name" className={UI_INPUT} /></FormField>
					<FormField label="Host" htmlFor="dialog-host" hint="IPv4, IPv6 or DNS name"><input id="dialog-host" className={UI_INPUT} /></FormField>
				</div>
			</Dialog>
			<ConfirmDialog
				open={deleteOpen}
				title="Delete production-api-01?"
				description="Metrics and audit history are kept; the node stops being managed."
				cancelLabel="Cancel"
				confirmLabel="Delete node"
				onCancel={() => setDeleteOpen(false)}
				onConfirm={() => setDeleteOpen(false)}
			/>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(
	<I18nProvider initialLocale="en">
		<Showcase />
	</I18nProvider>,
);
