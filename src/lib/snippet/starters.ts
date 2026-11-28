/**
 * Curated starter operational snippets (Linux bash + Windows PowerShell) so the
 * Snippets library and Snippet Picker provide immediate value even on a brand-new
 * installation or for users without `snippet:manage` saved snippets.
 *
 * Note on Windows agents: Windows agents execute via `cmd.exe`, so PowerShell
 * starters are wrapped in `powershell -NoProfile -Command "..."` for reliable
 * ad-hoc dispatch.
 */

export interface StarterSnippet {
  id: string;
  titleKey: string;
  descriptionKey: string;
  language: "bash" | "powershell";
  tags: string[];
  content: string;
}

export const STARTER_SNIPPETS: readonly StarterSnippet[] = [
  {
    id: "starter:linux-disk-usage",
    titleKey: "snippetsPage.starter.linuxDisk.title",
    descriptionKey: "snippetsPage.starter.linuxDisk.desc",
    language: "bash",
    tags: ["linux", "disk", "inspect"],
    content: "df -hT --exclude-type=tmpfs --exclude-type=devtmpfs && echo '--- TOP DIRECTORIES ---' && du -sh /* 2>/dev/null | sort -hr | head -10",
  },
  {
    id: "starter:linux-service-status",
    titleKey: "snippetsPage.starter.linuxService.title",
    descriptionKey: "snippetsPage.starter.linuxService.desc",
    language: "bash",
    tags: ["linux", "service", "systemd"],
    content: "systemctl status {{service}} --no-pager -l",
  },
  {
    id: "starter:linux-service-logs",
    titleKey: "snippetsPage.starter.linuxLogs.title",
    descriptionKey: "snippetsPage.starter.linuxLogs.desc",
    language: "bash",
    tags: ["linux", "logs", "service"],
    content: "journalctl -u {{service}} -n {{lines}} --no-pager",
  },
  {
    id: "starter:linux-os-resources",
    titleKey: "snippetsPage.starter.linuxOs.title",
    descriptionKey: "snippetsPage.starter.linuxOs.desc",
    language: "bash",
    tags: ["linux", "inspect", "system"],
    content: "cat /etc/os-release && echo '--- UPTIME & LOAD ---' && uptime && echo '--- MEMORY ---' && free -h",
  },
  {
    id: "starter:linux-docker-ps",
    titleKey: "snippetsPage.starter.linuxDocker.title",
    descriptionKey: "snippetsPage.starter.linuxDocker.desc",
    language: "bash",
    tags: ["linux", "docker", "inspect"],
    content: "docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}'",
  },
  {
    id: "starter:windows-disk-usage",
    titleKey: "snippetsPage.starter.winDisk.title",
    descriptionKey: "snippetsPage.starter.winDisk.desc",
    language: "powershell",
    tags: ["windows", "disk", "inspect"],
    content: 'powershell -NoProfile -Command "Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,FileSystemLabel,@{N=\'FreeGB\';E={[math]::Round($_.SizeRemaining/1GB,2)}},@{N=\'SizeGB\';E={[math]::Round($_.Size/1GB,2)}} | Format-Table -AutoSize"',
  },
  {
    id: "starter:windows-service-status",
    titleKey: "snippetsPage.starter.winService.title",
    descriptionKey: "snippetsPage.starter.winService.desc",
    language: "powershell",
    tags: ["windows", "service", "inspect"],
    content: 'powershell -NoProfile -Command "Get-Service -Name \'{{service}}\' | Format-Table Name,Status,StartType -AutoSize"',
  },
  {
    id: "starter:windows-os-version",
    titleKey: "snippetsPage.starter.winOs.title",
    descriptionKey: "snippetsPage.starter.winOs.desc",
    language: "powershell",
    tags: ["windows", "inspect", "system"],
    content: 'powershell -NoProfile -Command "Get-ComputerInfo | Select-Object CsName,WindowsProductName,OsVersion,OsUptime | Format-List"',
  },
] as const;
