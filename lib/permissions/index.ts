import { Role } from '../constants';

export type PermissionAction =
  | 'manage:staff'
  | 'manage:taxes'
  | 'manage:discounts'
  | 'assign:subscription_discounts'
  | 'manage:products'
  | 'manage:plans'
  | 'manage:templates'
  | 'manage:customers'
  | 'manage:subscriptions'
  | 'manage:requests'
  | 'manage:invoices'
  | 'manage:payments'
  | 'run:billing'
  | 'view:reports'
  | 'view:audit_logs'
  | 'view:outbox'
  | 'manage:settings'
  | 'portal:access';

export function can(role: Role, action: PermissionAction): boolean {
  if (role === 'ADMIN') {
    return true;
  }

  if (role === 'STAFF') {
    switch (action) {
      case 'manage:customers':
      case 'manage:subscriptions':
      case 'manage:requests':
      case 'manage:invoices':
      case 'manage:payments':
      case 'run:billing':
      case 'view:reports':
      case 'view:audit_logs':
        return true;
      case 'manage:staff':
      case 'manage:taxes':
      case 'manage:discounts':
      case 'assign:subscription_discounts':
      case 'manage:products':
      case 'manage:plans':
      case 'manage:templates':
      case 'view:outbox':
      case 'manage:settings':
      case 'portal:access':
        return false;
      default:
        return false;
    }
  }

  if (role === 'CUSTOMER') {
    return action === 'portal:access';
  }

  return false;
}
