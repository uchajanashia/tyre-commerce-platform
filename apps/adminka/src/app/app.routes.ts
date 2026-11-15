import { isDevMode } from '@angular/core';
import { Routes } from '@angular/router';

import { authGuard, governanceFeatureGuard, permissionGuard } from './core/auth.guard';
import { pendingGovernanceOperationGuard } from './core/pending-operation.guard';

export const routes: Routes = [
  ...(isDevMode()
    ? [
        {
          path: 'preview',
          loadChildren: () =>
            import('./features/operations/operations-preview').then((m) => m.previewRoutes),
        },
      ]
    : []),
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
    title: 'შესვლა — tyre.ge ადმინი',
  },
  {
    path: 'admin/invitations/accept',
    loadComponent: () =>
      import('./features/public-identity/invitation-accept.page').then(
        (m) => m.InvitationAcceptPage,
      ),
    title: 'მოწვევის მიღება — tyre.ge OPS',
  },
  {
    path: 'admin/mfa/setup',
    data: { enrollmentOnly: true },
    loadComponent: () =>
      import('./features/public-identity/invitation-accept.page').then(m => m.InvitationAcceptPage),
    title: 'Authenticator-ის დამატება — tyre.ge OPS',
  },
  {
    path: 'admin/password-reset',
    loadComponent: () =>
      import('./features/public-identity/password-reset.page').then((m) => m.PasswordResetPage),
    title: 'პაროლის აღდგენა — tyre.ge OPS',
  },
  {
    path: 'admin/recovery',
    loadComponent: () =>
      import('./features/public-identity/invitation-accept.page').then(
        (m) => m.InvitationAcceptPage,
      ),
    title: 'MFA recovery — tyre.ge OPS',
  },
  {
    path: 'password-reset/request',
    loadComponent: () =>
      import('./features/public-identity/password-reset.page').then((m) => m.PasswordResetPage),
    title: 'პაროლის აღდგენა — tyre.ge OPS',
  },
  {
    path: 'demo',
    loadComponent: () => import('./features/demo/admin-demo.page').then((m) => m.AdminDemoPage),
    title: 'ოპერაციების დემო — tyre.ge OPS',
  },
  {
    path: '',
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/operations/operations.page').then((m) => m.OperationsPageComponent),
        title: 'დაფა — tyre.ge ადმინი',
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/operations/operations.page').then((m) => m.OperationsPageComponent),
        canActivate: [permissionGuard],
        data: { view: 'orders', permission: 'orders.read' },
        title: 'tyre.ge — მართვა',
      },
      {
        path: 'payments',
        loadComponent: () =>
          import('./features/operations/operations.page').then((m) => m.OperationsPageComponent),
        canActivate: [permissionGuard],
        data: { view: 'payments', permission: 'payments.read' },
        title: 'tyre.ge — მართვა',
      },
      {
        path: 'customers',
        loadComponent: () =>
          import('./features/operations/operations.page').then((m) => m.OperationsPageComponent),
        canActivate: [permissionGuard],
        data: { view: 'customers', permission: 'orders.contacts.read' },
        title: 'tyre.ge — მართვა',
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./features/operations/operations.page').then((m) => m.OperationsPageComponent),
        canActivate: [permissionGuard],
        data: { view: 'inventory', permission: 'inventory.read' },
        title: 'tyre.ge — მართვა',
      },
      {
        path: 'vehicles',
        loadComponent: () =>
          import('./features/operations/operations.page').then((m) => m.OperationsPageComponent),
        canActivate: [permissionGuard],
        data: { view: 'vehicles', permission: 'catalog.read' },
        title: 'tyre.ge — მართვა',
      },
      {
        path: 'brands',
        loadComponent: () => import('./features/brands/brands.page').then((m) => m.BrandsPage),
        title: 'ბრენდები — tyre.ge ადმინი',
      },
      {
        path: 'tires',
        loadComponent: () => import('./features/tires/tires.page').then((m) => m.TiresPage),
        title: 'საბურავები — tyre.ge ადმინი',
      },
      {
        path: 'tires/:id',
        loadComponent: () =>
          import('./features/tires/tire-model-detail.page').then((m) => m.TireModelDetailPage),
        title: 'მოდელი — tyre.ge ადმინი',
      },
      {
        path: 'security',
        loadComponent: () =>
          import('./features/security/security.page').then((m) => m.SecurityPage),
        title: 'უსაფრთხოება — tyre.ge OPS',
      },
      {
        path: 'staff',
        loadComponent: () => import('./features/staff/staff.page').then((m) => m.StaffPage),
        canActivate: [permissionGuard],
        data: { permission: 'staff.read' },
        title: 'გუნდი და უფლებები — tyre.ge OPS',
      },
      {
        path: 'approvals',
        loadComponent: () =>
          import('./features/governance/approval-center.page').then((m) => m.ApprovalCenterPage),
        canActivate: [governanceFeatureGuard, permissionGuard],
        canDeactivate: [pendingGovernanceOperationGuard],
        data: { governanceFeature: 'approvals', permission: 'approvals.read' },
        title: 'დამტკიცების ცენტრი — tyre.ge OPS',
      },
      {
        path: 'approvals/:id',
        loadComponent: () =>
          import('./features/governance/approval-center.page').then((m) => m.ApprovalCenterPage),
        canActivate: [governanceFeatureGuard, permissionGuard],
        canDeactivate: [pendingGovernanceOperationGuard],
        data: { governanceFeature: 'approvals', permission: 'approvals.read' },
        title: 'დამტკიცების დეტალი — tyre.ge OPS',
      },
      {
        path: 'audit',
        loadComponent: () =>
          import('./features/governance/audit-operations.page').then((m) => m.AuditOperationsPage),
        canActivate: [governanceFeatureGuard, permissionGuard],
        data: { governanceFeature: 'audit', permission: 'audit.read', exactPermission: true },
        title: 'აუდიტის ოპერაციები — tyre.ge OPS',
      },
      {
        path: 'audit/:id',
        loadComponent: () =>
          import('./features/governance/audit-operations.page').then((m) => m.AuditOperationsPage),
        canActivate: [governanceFeatureGuard, permissionGuard],
        data: { governanceFeature: 'audit', permission: 'audit.read', exactPermission: true },
        title: 'აუდიტის დეტალი — tyre.ge OPS',
      },
      {
        path: 'jobs',
        loadComponent: () =>
          import('./features/governance/jobs-exceptions.page').then((m) => m.JobsExceptionsPage),
        canActivate: [governanceFeatureGuard, permissionGuard],
        data: { governanceFeature: 'jobs', permission: 'jobs.read', exactPermission: true },
        title: 'Jobs და გამონაკლისები — tyre.ge OPS',
      },
      {
        path: 'jobs/:id',
        loadComponent: () =>
          import('./features/governance/jobs-exceptions.page').then((m) => m.JobsExceptionsPage),
        canActivate: [governanceFeatureGuard, permissionGuard],
        data: { governanceFeature: 'jobs', permission: 'jobs.read', exactPermission: true },
        title: 'Job დეტალი — tyre.ge OPS',
      },
      // "Photos" is a filtered view of /tires (?photos=without) — no separate page.
    ],
  },
  { path: '**', redirectTo: '' },
];
