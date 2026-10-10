import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field, Input } from '@/components/ui/field';
import { CloudShader } from '@/components/ui/cloud-shader';
import { navFor } from '@/components/layout/AppShell';
import { permissionsFor, type SessionInfo, type SocietyRole } from '@smart-society/shared';

describe('Field', () => {
  it('labels the control and announces errors', () => {
    render(
      <Field label="Visitor name" error="Enter the visitor’s name">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Visitor name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the visitor’s name');
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });
});

describe('CloudShader', () => {
  it('falls back to a static gradient when WebGL is unavailable, keeping its content', () => {
    // jsdom has no WebGL: getContext returns null.
    render(
      <CloudShader>
        <h1>Hero</h1>
      </CloudShader>,
    );
    expect(screen.getByTestId('cloud-fallback')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hero' })).toBeInTheDocument();
  });
});

function session(role: SocietyRole, isPlatformAdmin = false): SessionInfo {
  return {
    user: { id: 'u', name: 'Test', email: 't@x.in', phone: null, isPlatformAdmin },
    membership: { id: 'm', role, societyId: 's', societyName: 'S', unitId: role === 'resident' ? 'unit' : null, unitLabel: null, timezone: 'Asia/Kolkata' },
    memberships: [],
    permissions: [...permissionsFor(role)],
    notificationPrefs: { emailEnabled: false, mutedTypes: [] },
  };
}
const labels = (s: SessionInfo) => navFor(s).flatMap((g) => g.items.map((i) => i.label));

describe('role-based navigation', () => {
  it('gives guards only the gate desk and notices', () => {
    expect(labels(session('guard'))).toEqual(['Gate desk', 'Notices']);
  });
  it('shows residents their household tools but no oversight pages', () => {
    const l = labels(session('resident'));
    expect(l).toEqual(expect.arrayContaining(['Visitors', 'Complaints', 'Amenities', 'Vehicles & parking', 'My household']));
    expect(l).not.toContain('Members');
    expect(l).not.toContain('Audit log');
    expect(l).not.toContain('Gate desk');
  });
  it('labels complaints as work orders for staff', () => {
    expect(labels(session('staff'))).toEqual(['Overview', 'Work orders', 'Notices']);
  });
  it('gives the committee reports but not the audit log or settings', () => {
    const l = labels(session('committee'));
    expect(l).toContain('Reports');
    expect(l).not.toContain('Audit log');
    expect(l).not.toContain('Society settings');
  });
  it('adds the platform page only for platform admins', () => {
    expect(labels(session('admin'))).not.toContain('Platform');
    expect(labels(session('admin', true))).toContain('Platform');
  });
});
