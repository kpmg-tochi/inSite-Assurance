import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  Bell,
  User,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Mail,
  Smartphone,
  Eye,
  FileText,
  Key,
  RefreshCw,
  UserX,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectSummaryDto } from '../../api/types';
import { useAuth } from '../../lib/auth-context';
import { formatDateTimeShort, formatLicenseCredential } from '../../lib/formatters';
import ContractorVerificationQueue from '../../components/ContractorVerificationQueue';
import { useContractorVerificationsQuery } from '../../queries/projects/useContractorVerificationQueries';
import {
  StandardTable,
  TableBadge,
  TableActionButton,
  TableActionMenu,
  TableColumnDef,
} from '../../components/table';

interface SettingsPageProps {
  project: ProjectSummaryDto | null;
}

interface FieldAgentRosterItem {
  id: string;
  fullName: string;
  roleTitle: string;
  tierLabel: string;
  joinCodeUsed: string;
  phone: string;
  lastActiveAt: string;
  status: 'ACTIVE' | 'REVOKED';
}

const INITIAL_FIELD_AGENTS: FieldAgentRosterItem[] = [
  {
    id: 'agent-1',
    fullName: 'QS Tunde Adebayo, FNIQS',
    roleTitle: 'Lead Independent Project Monitor',
    tierLabel: 'Tier 1: Monitor Inspector',
    joinCodeUsed: 'LKK-402-INS',
    phone: '+234 802 111 2233',
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    status: 'ACTIVE',
  },
  {
    id: 'agent-2',
    fullName: 'Arch. Kenneth Nwachukwu',
    roleTitle: 'Resident Clerk of Works (Civil Works)',
    tierLabel: 'Tier 2: Clerk of Works',
    joinCodeUsed: 'LKK-402-COW',
    phone: '+234 809 333 4455',
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    status: 'ACTIVE',
  },
  {
    id: 'agent-3',
    fullName: 'Engr. Babatunde Fashola Jr.',
    roleTitle: 'Assistant Site Supervisor (Earthworks)',
    tierLabel: 'Tier 3: Contractor Engineer',
    joinCodeUsed: 'LKK-402-CON',
    phone: '+234 805 777 8899',
    lastActiveAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    status: 'ACTIVE',
  },
];

export function SettingsPage({ project }: SettingsPageProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'ACCESS' | 'NOTIFICATIONS' | 'ACCOUNT'>('ACCESS');

  // Access Management State
  const [fieldAgents, setFieldAgents] = useState<FieldAgentRosterItem[]>(INITIAL_FIELD_AGENTS);
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterStatusFilter, setRosterStatusFilter] = useState<'ALL' | 'ACTIVE' | 'REVOKED'>('ALL');

  const filteredFieldAgents = useMemo(() => {
    return fieldAgents.filter((agent) => {
      const term = rosterSearch.toLowerCase();
      const matchesSearch =
        agent.fullName.toLowerCase().includes(term) ||
        agent.roleTitle.toLowerCase().includes(term) ||
        agent.joinCodeUsed.toLowerCase().includes(term) ||
        agent.phone.toLowerCase().includes(term);

      const matchesStatus =
        rosterStatusFilter === 'ALL' || agent.status === rosterStatusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [fieldAgents, rosterSearch, rosterStatusFilter]);

  const rosterColumns: TableColumnDef<FieldAgentRosterItem>[] = useMemo(
    () => [
      {
        id: 'agent',
        header: 'Agent & Title',
        tooltip:
          'Authorized field engineer or inspector registered on this facility',
        width: 'w-64',
        cell: (agent) => (
          <div>
            <div className="font-bold text-slate-900">{agent.fullName}</div>
            <div className="text-[11px] text-slate-500">{agent.roleTitle}</div>
          </div>
        ),
      },
      {
        id: 'tier',
        header: 'Independence Tier',
        tooltip:
          'Assurance tier binding evidence corroboration weight (Tier 1 Independent Monitor, Tier 2 Clerk of Works, Tier 3 Contractor)',
        width: 'w-52',
        cell: (agent) => (
          <TableBadge
            variant={
              agent.tierLabel.includes('Tier 1')
                ? 'info'
                : agent.tierLabel.includes('Tier 2')
                ? 'success'
                : 'neutral'
            }
          >
            {agent.tierLabel}
          </TableBadge>
        ),
      },
      {
        id: 'joinCode',
        header: 'Join Code Used',
        tooltip: 'Cryptographic join token redeemed during device onboarding',
        width: 'w-36',
        cell: (agent) => (
          <span className="font-semibold text-brand-primary">
            {agent.joinCodeUsed}
          </span>
        ),
      },
      {
        id: 'phone',
        header: 'Phone',
        tooltip: 'Registered contact number for device verification challenges',
        width: 'w-36',
        cell: (agent) => <span className="text-slate-600">{agent.phone}</span>,
      },
      {
        id: 'lastActive',
        header: 'Last Activity',
        tooltip:
          'Most recent geotagged evidence capture or telemetry received from this device',
        width: 'w-36',
        cell: (agent) => (
          <span className="text-slate-500 whitespace-nowrap">
            {formatDateTimeShort(agent.lastActiveAt)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Access Status',
        tooltip: 'Whether mobile app upload permissions are active or revoked',
        width: 'w-32',
        cell: (agent) => (
          <TableBadge
            variant={agent.status === 'ACTIVE' ? 'success' : 'danger'}
          >
            {agent.status === 'ACTIVE' ? 'Active Session' : 'Access Revoked'}
          </TableBadge>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        tooltip: 'Manage field agent permissions and device credentials',
        align: 'right',
        width: 'w-36',
        cell: (agent) => {
          if (user?.role === 'CONTRACTOR') return null;

          return (
            <div className="flex items-center justify-end gap-1.5">
              <TableActionButton
                onClick={() => handleToggleAgentStatus(agent.id)}
                variant={agent.status === 'ACTIVE' ? 'danger' : 'default'}
              >
                {agent.status === 'ACTIVE' ? 'Revoke' : 'Restore'}
              </TableActionButton>
              <TableActionMenu
                actions={[
                  {
                    label:
                      agent.status === 'ACTIVE'
                        ? 'Revoke Access'
                        : 'Restore Access',
                    variant: agent.status === 'ACTIVE' ? 'danger' : 'default',
                    onClick: () => handleToggleAgentStatus(agent.id),
                  },
                  {
                    label: 'Copy Join Code',
                    onClick: () => {
                      navigator.clipboard?.writeText(agent.joinCodeUsed);
                      toast.success(`Copied join code ${agent.joinCodeUsed}`);
                    },
                  },
                  {
                    label: 'Reset Device Binding',
                    onClick: () => {
                      toast.info(`Device reset initiated for ${agent.fullName}.`);
                    },
                  },
                ]}
              />
            </div>
          );
        },
      },
    ],
    [user?.role]
  );

  // Contractor Verifications from API
  const { data: verifications = [] } = useContractorVerificationsQuery(
    project?.id || 'all'
  );
  const pendingCount = verifications.filter(
    (v) => v.assuranceStatus === 'PENDING_APPROVAL'
  ).length;

  // Notification Preferences State
  const [notifyConflicts, setNotifyConflicts] = useState(true);
  const [notifyHoldPoints, setNotifyHoldPoints] = useState(true);
  const [notifyContractorOnboarding, setNotifyContractorOnboarding] = useState(true);
  const [notifyTrancheReleases, setNotifyTrancheReleases] = useState(true);
  const [notifyQueries, setNotifyQueries] = useState(true);
  const [forwardingEmail, setForwardingEmail] = useState(
    user?.email ? `assurance-alerts@${user.email.split('@')[1] || 'kpmg.com'}` : 'monitoring.desk@kpmg.com'
  );
  const [savingNotifications, setSavingNotifications] = useState(false);

  // Account / Security Form State (Demonstrative)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const handleToggleAgentStatus = (agentId: string) => {
    setFieldAgents((prev) =>
      prev.map((a) => {
        if (a.id === agentId) {
          const nextStatus = a.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE';
          if (nextStatus === 'REVOKED') {
            toast.warning(`Revoked mobile project access for ${a.fullName}.`);
          } else {
            toast.success(`Restored mobile project access for ${a.fullName}.`);
          }
          return { ...a, status: nextStatus };
        }
        return a;
      })
    );
  };

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNotifications(true);
    setTimeout(() => {
      setSavingNotifications(false);
      toast.success(
        `Notification preferences and forwarding email (${forwardingEmail}) updated.`
      );
    }, 400);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error('Please enter your current and new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    toast.success(
      'Account credentials updated. (Demonstrative — In production, changes sync with Corporate SSO)'
    );
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleToggle2Fa = () => {
    const next = !twoFactorEnabled;
    setTwoFactorEnabled(next);
    if (next) {
      toast.info('Two-Factor Authentication (2FA) is in demonstrative mode.');
    } else {
      toast.info('Two-Factor Authentication disabled.');
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">Governance &amp; App Settings</h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-50 text-brand-primary border border-blue-200">
              {user?.role === 'MONITOR'
                ? 'Independent Monitor Control'
                : user?.role === 'LENDER'
                  ? 'Financier Oversight'
                  : 'Contractor Portal Settings'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Manage mobile field agent credentials, contractor assurance onboarding, notification
            routing, and workspace security.
          </p>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start md:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('ACCESS')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'ACCESS'
                ? 'bg-white text-brand-primary shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Access &amp; Assurance</span>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('NOTIFICATIONS')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'NOTIFICATIONS'
                ? 'bg-white text-brand-primary shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>Notifications</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ACCOUNT')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
              activeTab === 'ACCOUNT'
                ? 'bg-white text-brand-primary shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Account &amp; Security</span>
          </button>
        </div>
      </div>

      {/* 2. TAB A: Access Management & Contractor Assurance */}
      {activeTab === 'ACCESS' && (
        <div className="space-y-4">
          {/* Assurance Value Proposition Notice */}
          <div className="bg-blue-50/70 border border-blue-200/90 rounded-2xl p-4 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-brand-primary shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900/90 leading-relaxed">
              <strong className="font-bold text-brand-navy block mb-0.5">
                Contractor Identity &amp; Competence Assurance
              </strong>
              Contractors joining via mobile must submit a valid government photo ID, undergo live
              facial liveness verification, and provide proof of professional qualifications (COREN
              / QSRBN). Independent Monitors and Lenders review this verification before project
              capture permissions are activated, preventing unauthorized access and fraudulent
              drawdown logs.
            </div>
          </div>

          {/* Pending Contractor Onboarding Approvals Queue */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
            <ContractorVerificationQueue projectId={project?.id || 'all'} />
          </div>

          {/* Active Field Agent Roster & Revocation Standard Table */}
          <StandardTable<FieldAgentRosterItem>
            title={
              <div className="flex items-center gap-2.5">
                <span>Active Mobile Field Personnel</span>
                <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-blue-100 border border-white/15">
                  {fieldAgents.length} Enrolled Devices
                </span>
              </div>
            }
            subtitle="Field agents authorized to submit geotagged photos, audio notes, and Hold-Point logs"
            search={{
              value: rosterSearch,
              onChange: setRosterSearch,
              placeholder: 'Search agent name, title, code, or phone...',
            }}
            filters={
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setRosterStatusFilter('ALL')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                    rosterStatusFilter === 'ALL'
                      ? 'bg-brand-navy text-white shadow-2xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  All ({fieldAgents.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterStatusFilter('ACTIVE')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                    rosterStatusFilter === 'ACTIVE'
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Active Sessions (
                  {fieldAgents.filter((a) => a.status === 'ACTIVE').length})
                </button>
                <button
                  type="button"
                  onClick={() => setRosterStatusFilter('REVOKED')}
                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                    rosterStatusFilter === 'REVOKED'
                      ? 'bg-rose-600 text-white shadow-2xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Revoked (
                  {fieldAgents.filter((a) => a.status === 'REVOKED').length})
                </button>
              </div>
            }
            columns={rosterColumns}
            data={filteredFieldAgents}
            keyExtractor={(item) => item.id}
            emptyState={{
              title: 'No field agents match your search',
              description:
                'Try adjusting the keyword search or active status filter.',
            }}
          />
        </div>
      )}

      {/* 3. TAB B: Notification Preferences & Forwarding */}
      {activeTab === 'NOTIFICATIONS' && (
        <form onSubmit={handleSaveNotifications} className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Governance Notification Triggers
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure which physical-to-financial events trigger in-app alerts and email forwarding.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 transition cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyConflicts}
                  onChange={(e) => setNotifyConflicts(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-900">
                    Evidence Discrepancy &amp; Conflict Flags
                  </div>
                  <div className="text-slate-500">
                    Notify when contractor claims exceed geotagged field quantities or when ratings are
                    marked Contradicted.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 transition cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyHoldPoints}
                  onChange={(e) => setNotifyHoldPoints(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-900">
                    Pre-Pour Visual Hold-Point Violations
                  </div>
                  <div className="text-xs text-slate-500">
                    Alert when an IPC claim includes structural concrete or buried work without a
                    confirmed pre-pour inspection log.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 transition cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyContractorOnboarding}
                  onChange={(e) => setNotifyContractorOnboarding(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-900">
                    Contractor Assurance Onboarding Submissions
                  </div>
                  <div className="text-xs text-slate-500">
                    Alert Independent Monitors and Lenders when a new on-site contractor submits ID
                    and selfie liveness for approval.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 transition cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyTrancheReleases}
                  onChange={(e) => setNotifyTrancheReleases(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-900">
                    Tranche Drawdown Certifications &amp; Releases
                  </div>
                  <div className="text-xs text-slate-500">
                    Notify participants when an Interim Payment Certificate is signed by the Monitor
                    or approved by the Lender.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200/80 hover:bg-slate-50 transition cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyQueries}
                  onChange={(e) => setNotifyQueries(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-brand-primary focus:ring-brand-primary"
                />
                <div className="text-xs">
                  <div className="font-bold text-slate-900">
                    Dispute Query Threads &amp; Contractor Clarifications
                  </div>
                  <div className="text-xs text-slate-500">
                    Real-time alerts when queries are raised on specific BOQ line items or when
                    contractors respond with evidence.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Email Forwarding Destination */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Notification Forwarding Destination
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Send urgent governance alerts directly to your institution's capital project advisory
                inbox.
              </p>
            </div>

            <div className="max-w-md space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Forwarding Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  value={forwardingEmail}
                  onChange={(e) => setForwardingEmail(e.target.value)}
                  placeholder="e.g. assurance.desk@kpmg.com"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                  required
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Multiple addresses can be separated by commas in enterprise environments.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={savingNotifications}
                className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold transition shadow-xs disabled:opacity-50"
              >
                {savingNotifications ? 'Saving...' : 'Save Notification Preferences'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 4. TAB C: Account & Security (Demonstrative) */}
      {activeTab === 'ACCOUNT' && (
        <div className="space-y-4">
          {/* Active Profile Summary */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Professional Profile</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">Full Name</span>
                <span className="font-bold text-slate-900">{user?.fullName || 'User'}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">Corporate Email</span>
                <span className="font-bold text-slate-900">{user?.email || '—'}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">Organization</span>
                <span className="font-bold text-slate-900">
                  {user?.organizationName || 'KPMG Capital Advisory'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70">
                <span className="text-slate-400 block text-[11px]">Professional Credential</span>
                <span className="font-bold text-brand-primary">
                  {formatLicenseCredential(
                    user?.professionalLicenseType,
                    user?.professionalLicenseNumber
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Change Password Form (Demonstrative) */}
          <form
            onSubmit={handlePasswordSubmit}
            className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Change Password</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update your portal credentials. (Demonstrative: production connects to corporate
                  SSO).
                </p>
              </div>
              <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full">
                SSO Enabled
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary"
                />
              </div>
            </div>

            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition shadow-xs"
            >
              Update Password
            </button>
          </form>

          {/* Two-Factor Authentication (2FA) (Demonstrative) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex items-center justify-between">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-brand-primary flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Two-Factor Authentication (2FA)
                  </h3>
                  <span className="text-[10px] font-semibold bg-blue-50 text-brand-primary border border-blue-200 px-2 py-0.2 rounded-full">
                    Demonstrative
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Require an authenticator app (TOTP) verification code during sign in to protect
                  disbursement certification authority.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggle2Fa}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition border ${
                twoFactorEnabled
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              {twoFactorEnabled ? '2FA Enabled' : 'Enable 2FA'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

