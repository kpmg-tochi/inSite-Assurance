import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notificationTarget, projectAlertOf } from "./notificationTarget";

const projectId = "11111111-1111-4111-8111-111111111111";
const visitId = "22222222-2222-4222-8222-222222222222";

describe("notificationTarget (UBEC IRL alerts)", () => {
  it("opens the visit, the defects or the project", () => {
    assert.deepEqual(notificationTarget({ actionType: "OPEN_VISIT", projectId, metadata: { visitId } }), { screen: "Visit", visitId });
    assert.deepEqual(notificationTarget({ actionType: "OPEN_DEFECTS", projectId, metadata: {} }), { screen: "Defects", projectId });
    assert.deepEqual(notificationTarget({ actionType: "NONE", projectId, metadata: { alertKey: "SITE_UPDATE_OVERDUE" } }), { screen: "Project", projectId });
  });

  it("only marks other notifications read", () => {
    assert.equal(notificationTarget({ actionType: "OPEN_VISIT", projectId, metadata: {} }), null);
    assert.equal(notificationTarget({ actionType: "NONE", projectId, metadata: {} }), null);
    assert.equal(notificationTarget({ actionType: "NONE", projectId, metadata: { alertKey: "NOT_AN_ALERT" } as never }), null);
  });

  it("reads the alert key", () => {
    assert.equal(projectAlertOf({ metadata: { alertKey: "STALLED" } }), "STALLED");
    assert.equal(projectAlertOf({ metadata: {} }), null);
  });
});
