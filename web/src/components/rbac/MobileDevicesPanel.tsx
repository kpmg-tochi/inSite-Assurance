import { useMemo, useState } from 'react';
import type { MobileDeviceDto } from '@insite/shared';
import { useMobileDevicesQuery } from '../../queries/rbac/useRbacQueries';
import { useRevokeMobileDeviceMutation } from '../../mutations/rbac/useRbacMutations';
import { formatDateTimeShort } from '../../lib/formatters';
import { StandardTable, TableActionButton, TableBadge, type TableColumnDef } from '../table';

/**
 * Phase 5: devices that pre-provisioned users have signed in on. Revoking a device blocks every
 * project for that person on that device; per-project sessions are revoked in the roster below.
 */
export function MobileDevicesPanel({ canRevoke }: { canRevoke: boolean }) {
  const { data: devices = [], isLoading } = useMobileDevicesQuery(true);
  const revokeMutation = useRevokeMobileDeviceMutation();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return devices;
    return devices.filter((d) =>
      [d.userFullName, d.userEmail, d.deviceModel ?? '', d.deviceId].some((v) => v.toLowerCase().includes(term))
    );
  }, [devices, search]);

  const columns: TableColumnDef<MobileDeviceDto>[] = useMemo(
    () => [
      {
        id: 'user',
        header: 'Person',
        width: 'w-64',
        cell: (d) => (
          <div>
            <div className="font-bold text-slate-900">{d.userFullName}</div>
            <div className="text-[11px] text-slate-500">
              {d.userEmail}
              {d.mobileRoleName ? ` · ${d.mobileRoleName}` : ''}
            </div>
          </div>
        ),
      },
      {
        id: 'device',
        header: 'Device',
        width: 'w-52',
        cell: (d) => (
          <div>
            <div className="text-slate-800">{d.deviceModel ?? 'Unknown model'}</div>
            <div className="text-[11px] text-slate-500 font-mono">{d.deviceOs ?? d.deviceId}</div>
          </div>
        ),
      },
      {
        id: 'projects',
        header: 'Project sessions',
        width: 'w-32',
        cell: (d) => <span className="text-slate-700">{d.sessionCount}</span>,
      },
      {
        id: 'lastSeen',
        header: 'Last sign-in',
        width: 'w-36',
        cell: (d) => (
          <span className="text-slate-500 whitespace-nowrap">
            {d.lastSeenAt ? formatDateTimeShort(d.lastSeenAt) : '—'}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        width: 'w-28',
        cell: (d) => (
          <TableBadge variant={d.revokedAt ? 'danger' : 'success'}>
            {d.revokedAt ? 'Revoked' : 'Active'}
          </TableBadge>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        align: 'right',
        width: 'w-28',
        cell: (d) =>
          canRevoke && !d.revokedAt ? (
            <TableActionButton
              variant="danger"
              onClick={() => {
                if (
                  window.confirm(
                    `Revoke ${d.deviceModel ?? 'this device'} for ${d.userFullName}? They will be blocked on every project on this device until they sign in on another one.`
                  )
                ) {
                  revokeMutation.mutate({ deviceRowId: d.id });
                }
              }}
            >
              Revoke device
            </TableActionButton>
          ) : null,
      },
    ],
    [canRevoke, revokeMutation]
  );

  return (
    <StandardTable<MobileDeviceDto>
      title={<span>Signed-in mobile devices</span>}
      subtitle="People with a pre-provisioned role sign in with their account. Revoking a device blocks all their projects on it."
      search={{ value: search, onChange: setSearch, placeholder: 'Search person, email or device...' }}
      columns={columns}
      data={filtered}
      loading={isLoading}
      keyExtractor={(d) => d.id}
      emptyState={{
        title: 'No signed-in devices yet',
        description: 'Devices appear here after someone with a pre-provisioned mobile role signs in to the app.',
      }}
    />
  );
}
