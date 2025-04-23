/**
 * Configuration for tenants in the Just-In-Time Knowledge Base application
 * 
 * Each tenant has:
 * - Name: Display name for the tenant
 * - Id: Unique identifier for the tenant
 * - QueryRate: Maximum number of queries allowed per minute
 * - MaxFiles: Maximum number of files allowed per project
 * - FilesTTLHours: Time-to-live for files in hours before automatic expiration
 */

export interface Tenant {
  Name: string;
  Id: string;
  QueryRate: number;
  MaxFiles: number;
  FilesTTLHours: number;
}

export const tenants: Tenant[] = [
  {
    Name: 'Tenant 1',
    Id: 'tenant1',
    QueryRate: 5,
    MaxFiles: 5,
    FilesTTLHours: 12
  },
  {
    Name: 'Tenant 2',
    Id: 'tenant2',
    QueryRate: 4,
    MaxFiles: 4,
    FilesTTLHours: 6
  }, 
  {
    Name: 'Tenant 3',
    Id: 'tenant3',
    QueryRate: 3,
    MaxFiles: 3,
    FilesTTLHours: 1
  }
];
