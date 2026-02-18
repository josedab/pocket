/**
 * BreachNotificationManager - Breach detection and notification for Pocket.
 *
 * Provides breach reporting, impact assessment, and notification
 * tracking to meet regulatory requirements (GDPR 72-hour rule,
 * HIPAA breach notification, etc.).
 *
 * @module @pocket/compliance
 *
 * @example
 * ```typescript
 * import { createBreachNotificationManager } from '@pocket/compliance';
 *
 * const manager = createBreachNotificationManager();
 * const breach = manager.reportBreach({
 *   severity: 'high',
 *   affectedRecords: 1500,
 *   description: 'Unauthorized access to user data',
 *   detectedAt: Date.now(),
 * });
 *
 * manager.breach$.subscribe((b) => console.log('Breach reported:', b.id));
 * ```
 *
 * @see {@link GDPRManager} for GDPR compliance management
 */

import { Subject, type Observable } from 'rxjs';
import type { BreachNotification } from './types.js';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Manages breach notifications and impact assessment.
 *
 * Tracks security breaches, assesses their impact, and monitors
 * notification compliance windows.
 */
export class BreachNotificationManager {
  private readonly breaches: BreachNotification[] = [];
  private readonly breachSubject = new Subject<BreachNotification>();

  /**
   * Observable stream of breach notifications.
   *
   * @example
   * ```typescript
   * manager.breach$.subscribe((breach) => {
   *   console.log(`Breach ${breach.id}: ${breach.severity}`);
   * });
   * ```
   */
  readonly breach$: Observable<BreachNotification> = this.breachSubject.asObservable();

  /**
   * Report a new security breach.
   *
   * @param breach - Breach details (id, status, and notifiedAt are auto-generated)
   * @returns The complete breach notification record
   *
   * @example
   * ```typescript
   * const breach = manager.reportBreach({
   *   severity: 'critical',
   *   affectedRecords: 5000,
   *   description: 'Database credentials exposed',
   *   detectedAt: Date.now(),
   * });
   * ```
   */
  reportBreach(
    breach: Omit<BreachNotification, 'id' | 'status' | 'notifiedAt'>
  ): BreachNotification {
    const record: BreachNotification = {
      ...breach,
      id: generateId(),
      status: 'detected',
      notifiedAt: null,
    };

    this.breaches.push(record);
    this.breachSubject.next(record);
    return record;
  }

  /**
   * Get breach records, optionally filtered by severity or status.
   *
   * @param options - Filter options
   * @returns Filtered breach records
   *
   * @example
   * ```typescript
   * const critical = manager.getBreaches({ severity: 'critical' });
   * ```
   */
  getBreaches(options?: { severity?: string; status?: string }): BreachNotification[] {
    let results = [...this.breaches];
    if (options?.severity) {
      results = results.filter((b) => b.severity === options.severity);
    }
    if (options?.status) {
      results = results.filter((b) => b.status === options.status);
    }
    return results;
  }

  /**
   * Update the status of a breach notification.
   *
   * @param id - The breach ID
   * @param status - The new status
   * @param _notes - Optional notes about the status change
   * @returns The updated breach record
   *
   * @example
   * ```typescript
   * const updated = manager.updateBreachStatus('breach-1', 'contained', 'Patched vulnerability');
   * ```
   */
  updateBreachStatus(id: string, status: string, _notes?: string): BreachNotification {
    const breach = this.breaches.find((b) => b.id === id);
    if (!breach) {
      throw new Error(`Breach not found: ${id}`);
    }

    breach.status = status as BreachNotification['status'];

    if (status === 'notified') {
      breach.notifiedAt = Date.now();
    }

    return breach;
  }

  /**
   * Assess the impact of a breach.
   *
   * Provides a summary of affected users, data types, severity,
   * and regulatory notification requirements.
   *
   * @param breachId - The breach ID to assess
   * @returns Impact assessment results
   *
   * @example
   * ```typescript
   * const impact = manager.assessImpact('breach-1');
   * console.log(impact.regulatoryRequirements);
   * ```
   */
  assessImpact(breachId: string): {
    affectedUsers: number;
    dataTypes: string[];
    severity: string;
    regulatoryRequirements: string[];
  } {
    const breach = this.breaches.find((b) => b.id === breachId);
    if (!breach) {
      throw new Error(`Breach not found: ${breachId}`);
    }

    const requirements: string[] = [];
    if (breach.severity === 'high' || breach.severity === 'critical') {
      requirements.push('GDPR: Notify supervisory authority within 72 hours');
      requirements.push('GDPR: Notify affected data subjects without undue delay');
    }
    if (breach.affectedRecords > 500) {
      requirements.push('HIPAA: Notify HHS and affected individuals within 60 days');
      requirements.push('HIPAA: Notify prominent media outlets if >500 affected');
    }
    requirements.push('SOC 2: Document incident in security incident log');

    const dataTypes: string[] = ['personal_data'];
    if (breach.severity === 'critical') {
      dataTypes.push('sensitive_data', 'credentials');
    }

    return {
      affectedUsers: breach.affectedRecords,
      dataTypes,
      severity: breach.severity,
      regulatoryRequirements: requirements,
    };
  }

  /**
   * Check if a breach is still within the regulatory notification window.
   *
   * @param breachId - The breach ID to check
   * @param hoursLimit - Notification window in hours (default: 72 for GDPR)
   * @returns Whether the breach is within the notification window
   *
   * @example
   * ```typescript
   * if (manager.isWithinNotificationWindow('breach-1', 72)) {
   *   console.log('Still within GDPR notification window');
   * }
   * ```
   */
  isWithinNotificationWindow(breachId: string, hoursLimit = 72): boolean {
    const breach = this.breaches.find((b) => b.id === breachId);
    if (!breach) {
      throw new Error(`Breach not found: ${breachId}`);
    }

    const elapsed = Date.now() - breach.detectedAt;
    const limitMs = hoursLimit * 60 * 60 * 1000;
    return elapsed <= limitMs;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.breachSubject.complete();
    this.breaches.length = 0;
  }
}

/**
 * Create a BreachNotificationManager instance.
 *
 * @returns A new BreachNotificationManager instance
 *
 * @example
 * ```typescript
 * const manager = createBreachNotificationManager();
 * ```
 */
export function createBreachNotificationManager(): BreachNotificationManager {
  return new BreachNotificationManager();
}
