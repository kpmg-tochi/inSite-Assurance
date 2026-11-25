import { activeProjectAlertKeys, type ProjectAlertKey } from '@insite/shared';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';

/**
 * UBEC IRL: the active early-warning alerts a web user may see on a project row (directory,
 * portfolio, overview). None unless the project is ACTIVE; spend ahead of progress only for users
 * who may see payments.
 */
export function alertKeysForViewer(project: { status: string; alertStateJson: unknown }, webUser: WebJwtPayload | undefined): ProjectAlertKey[] {
  return activeProjectAlertKeys(project.alertStateJson, {
    status: project.status,
    canView: (perms) => hasWebPermission(webUser, ...perms),
  });
}
