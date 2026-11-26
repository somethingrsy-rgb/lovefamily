import fs from 'node:fs';
import * as F from './services/family.js';
import * as R from './services/routines.js';
import * as S from './services/stamps.js';
import * as M from './services/money.js';
import * as W from './services/wishes.js';
import * as X from './services/social.js';
import * as T from './services/timers.js';
import * as SP from './services/supplies.js';
import * as FA from './services/famact.js';
import * as TT from './services/timetable.js';
import * as ML from './services/meals.js';
import { id as vid } from './util.js';

// [method, path, handler(ctx, h) , opts]
// h = { core, params, query, body, ip, req, res, raw }
export function buildRoutes(app) {
  const r = [];
  const add = (method, path, fn, opts = {}) => r.push({ method, path, fn, ...opts });
  const P = (h, k = 'id') => vid(h.params[k], k);

  // ---- 인증/가족 ----
  add('POST', '/api/auth/register', (c, h) => { const r = F.register(h.core, h.body); return { $session: r.session, status: 201, body: { ok: true, recoveryCode: r.recoveryCode, familyCode: r.familyCode } }; }, { auth: false, session: true });
  add('POST', '/api/auth/join', (c, h) => { const r = F.join(h.core, h.body); return { $session: r.session, status: 201, body: { ok: true, recoveryCode: r.recoveryCode } }; }, { auth: false, session: true });
  add('POST', '/api/auth/reset-password', (c, h) => F.resetPassword(h.core, h.body, h.ip), { auth: false });
  add('POST', '/api/auth/login', (c, h) => ({ $session: F.login(h.core, h.body, h.ip).session }), { auth: false, session: true });
  add('POST', '/api/auth/kid-pair', (c, h) => ({ $session: F.kidPair(h.core, h.body, h.ip).session, status: 201 }), { auth: false, session: true });
  add('POST', '/api/kids/:id/pair-code', (c, h) => ({ status: 201, body: F.createPairCode(h.core, c, P(h)) }));
  add('GET', '/api/kids/:id/devices', (c, h) => F.listKidDevices(h.core, c, P(h)));
  add('DELETE', '/api/kid-devices/:id', (c, h) => F.revokeKidDevice(h.core, c, P(h)));
  add('POST', '/api/auth/logout', (c, h) => { F.logout(h.core, c); return { $clear: true, ok: true }; });
  add('POST', '/api/me/password', (c, h) => F.changePassword(h.core, c, h.body));
  add('POST', '/api/me/recovery', (c, h) => F.newRecoveryCode(h.core, c, h.body, h.ip));
  add('POST', '/api/kids', (c, h) => ({ status: 201, body: F.addKid(h.core, c, h.body) }));
  add('POST', '/api/auth/reauth', (c, h) => F.reauth(h.core, c, h.body, h.ip));
  add('GET', '/api/me', (c, h) => F.me(h.core, c));
  add('POST', '/api/family/reset', (c, h) => F.resetFamilyData(h.core, c, h.body));
  add('PUT', '/api/layout', (c, h) => F.setLayout(h.core, c, h.body));
  add('PATCH', '/api/family', (c, h) => F.updateFamily(h.core, c, h.body));
  add('POST', '/api/family/code/rotate', (c, h) => F.rotateCode(h.core, c));
  add('PATCH', '/api/members/:id', (c, h) => F.updateMember(h.core, c, P(h), h.body));
  add('DELETE', '/api/members/:id', (c, h) => F.removeAdult(h.core, c, P(h)));
  add('PUT', '/api/kids/:id/pin', (c, h) => F.setKidPin(h.core, c, P(h), h.body.pin));
  add('POST', '/api/kids/:id/unlock', (c, h) => F.unlockKid(h.core, c, P(h), h.body.pin));

  add('POST', '/api/pets/act', (c, h) => X.petAct(h.core, c, h.body.kidId, h.body.kind, h.body.pet));
  add('PUT', '/api/pets/:pet/owner', (c, h) => F.setPetOwner(h.core, c, h.params.pet, h.body.kidId));
  add('PUT', '/api/walkers/:id', (c, h) => X.setWalker(h.core, c, P(h), h.body.cell));
  // ---- 홈 ----
  add('GET', '/api/home', (c, h) => { R.ensureToday(h.core, c.familyId); return X.home(h.core, c); });
  add('GET', '/api/adult/home', (c, h) => { R.ensureToday(h.core, c.familyId); return X.adultHome(h.core, c); });
  add('PUT', '/api/status', (c, h) => X.setStatus(h.core, c, h.body));

  // ---- 할일/하루 ----
  add('GET', '/api/kids/:id/routines', (c, h) => R.listRoutines(h.core, c, P(h)));
  add('POST', '/api/routines', (c, h) => ({ status: 201, body: R.createRoutines(h.core, c, h.body) }));
  add('PATCH', '/api/routines/:id', (c, h) => R.updateRoutine(h.core, c, P(h), h.body));
  add('DELETE', '/api/routines/:id', (c, h) => R.deleteRoutine(h.core, c, P(h), h.query.applyToday === '1'));
  add('PUT', '/api/kids/:id/routines/order', (c, h) => R.reorderRoutines(h.core, c, P(h), h.body.order));
  add('GET', '/api/kids/:id/day', (c, h) => { c.kid(P(h)); return R.dayState(h.core, P(h), h.query.date || h.core.today()); });
  add('PUT', '/api/day-items/:id', (c, h) => R.setItemDone(h.core, c, P(h), h.body.done));
  add('POST', '/api/kids/:id/day/request', (c, h) => { c.kid(P(h)); return R.requestStamp(h.core, c, P(h), h.body.date || h.core.today()); });
  add('GET', '/api/kids/:id/calendar', (c, h) => R.calendar(h.core, c, P(h), h.query.month || h.core.today().slice(0, 7)));

  // ---- 도장 ----
  add('GET', '/api/approvals', (c, h) => S.listApprovals(h.core, c));
  add('GET', '/api/stamp-requests/:id', (c, h) => S.getRequestDetail(h.core, c, P(h)));
  add('POST', '/api/stamp-requests/:id/approve', (c, h) => S.approveStamp(h.core, c, P(h)));
  add('POST', '/api/stamp-requests/:id/recheck', (c, h) => S.requestRecheck(h.core, c, P(h), h.body));
  add('POST', '/api/stamps/:id/void', (c, h) => S.voidStamp(h.core, c, P(h), h.body));
  add('GET', '/api/kids/:id/stamps', (c, h) => S.getBoards(h.core, c, P(h)));
  add('POST', '/api/settlements/:id/settle', (c, h) => S.settle(h.core, c, P(h)));
  add('POST', '/api/praises', (c, h) => S.addPraise(h.core, c, h.body));

  // ---- 저금통 ----
  add('GET', '/api/kids/:id/wallet', (c, h) => M.getWallet(h.core, c, P(h)));
  add('GET', '/api/kids/:id/ledger', (c, h) => M.getLedger(h.core, c, P(h), h.query.month));
  add('POST', '/api/kids/:id/opening-balance', (c, h) => M.setOpening(h.core, c, P(h), h.body.amount));
  add('POST', '/api/kids/:id/deposits', (c, h) => ({ status: 201, body: M.directDeposit(h.core, c, P(h), { ...h.body, idemKey: h.idemKey }) }));
  add('POST', '/api/kids/:id/adjust', (c, h) => M.adjust(h.core, c, P(h), h.body));
  add('POST', '/api/kids/:id/cash-spent', (c, h) => ({ status: 201, body: M.cashSpent(h.core, c, P(h), h.body) }));
  add('GET', '/api/kids/:id/requests', (c, h) => M.listRequests(h.core, c, P(h)));
  add('POST', '/api/kids/:id/requests', (c, h) => ({ status: 201, body: M.createRequest(h.core, c, P(h), h.body) }));
  add('GET', '/api/money/requests/:id', (c, h) => M.getRequest(h.core, c, P(h)));
  add('DELETE', '/api/ledger/:id', (c, h) => M.deleteLedger(h.core, c, P(h)));
  add('POST', '/api/kids/:id/ledger/clear', (c, h) => M.clearLedgerMonth(h.core, c, P(h), h.body.month));
  add('POST', '/api/money/requests/:id/approve', (c, h) => M.approveRequest(h.core, c, P(h)));
  add('POST', '/api/money/requests/:id/reject', (c, h) => M.rejectRequest(h.core, c, P(h), h.body));
  add('POST', '/api/money/requests/:id/cancel', (c, h) => M.cancelRequest(h.core, c, P(h)));
  add('POST', '/api/money/requests/:id/confirm', (c, h) => M.confirmDeposit(h.core, c, P(h)));
  add('POST', '/api/money/requests/:id/pay', (c, h) => M.payRequest(h.core, c, P(h)));
  add('POST', '/api/money/requests/:id/complete', (c, h) => M.completePurchase(h.core, c, P(h), h.body));

  // ---- 사고 싶은 것 / 미션 ----
  add('GET', '/api/kids/:id/wishes', (c, h) => W.listWishes(h.core, c, P(h)));
  add('POST', '/api/kids/:id/wishes', (c, h) => ({ status: 201, body: W.createWish(h.core, c, P(h), h.body) }));
  add('PATCH', '/api/wishes/:id', (c, h) => W.updateWish(h.core, c, P(h), h.body));
  add('DELETE', '/api/wishes/:id', (c, h) => W.removeWish(h.core, c, P(h)));
  add('POST', '/api/wishes/:id/goal', (c, h) => W.setGoal(h.core, c, P(h)));
  add('POST', '/api/wishes/:id/allocate', (c, h) => W.allocate(h.core, c, P(h), h.body));
  add('POST', '/api/wishes/:id/cancel-goal', (c, h) => W.cancelGoal(h.core, c, P(h)));
  add('POST', '/api/wishes/:id/buy', (c, h) => W.buyRequest(h.core, c, P(h), h.body));
  add('GET', '/api/kids/:id/missions', (c, h) => W.listMissions(h.core, c, P(h)));
  add('POST', '/api/missions', (c, h) => ({ status: 201, body: W.createMission(h.core, c, h.body) }));
  add('POST', '/api/missions/:id/request', (c, h) => W.requestMission(h.core, c, P(h)));
  add('POST', '/api/missions/:id/confirm', (c, h) => W.confirmMission(h.core, c, P(h)));
  add('POST', '/api/missions/:id/reject', (c, h) => W.confirmMission(h.core, c, P(h), { reject: true }));
  add('DELETE', '/api/missions/:id', (c, h) => W.cancelMission(h.core, c, P(h)));

  // ---- 사진/알림장/한마디/일정 ----
  add('POST', '/api/photos', (c, h) => ({ status: 201, body: X.savePhoto(h.core, c, h.raw, { kind: h.req.headers['x-photo-kind'], kidId: h.req.headers['x-kid-id'] }) }), { raw: true });
  add('GET', '/api/photos/:id', (c, h) => { const p = X.openPhoto(h.core, c, P(h)); return { file: p.file, mime: p.mime }; });
  add('GET', '/api/posts', (c, h) => X.listPosts(h.core, c, { kidId: h.query.kidId, limit: h.query.limit }));
  add('POST', '/api/posts', (c, h) => ({ status: 201, body: X.createPost(h.core, c, h.body) }));
  add('POST', '/api/posts/:id/pin', (c, h) => X.pinPost(h.core, c, P(h), !!h.body.pinned));
  add('POST', '/api/posts/:id/read', (c, h) => X.readPost(h.core, c, P(h)));
  add('PATCH', '/api/posts/:id', (c, h) => X.updatePost(h.core, c, P(h), h.body));
  add('DELETE', '/api/posts/:id', (c, h) => X.deletePost(h.core, c, P(h)));
  add('GET', '/api/notes', (c, h) => X.listNotes(h.core, c, 20));
  add('POST', '/api/notes', (c, h) => ({ status: 201, body: X.addNote(h.core, c, h.body) }));
  add('POST', '/api/events', (c, h) => ({ status: 201, body: X.addEvent(h.core, c, h.body) }));
  add('DELETE', '/api/events/:id', (c, h) => X.deleteEvent(h.core, c, P(h)));
  add('GET', '/api/calendar', (c, h) => X.familyCalendar(h.core, c, h.query.month || h.core.today().slice(0, 7)));

  // ---- 메시지/알림/푸시 ----
  add('GET', '/api/threads', (c, h) => X.listThreads(h.core, c, h.query.kidId));
  add('GET', '/api/threads/:kidId/:adultId', (c, h) => X.getThread(h.core, c, P(h, 'kidId'), P(h, 'adultId')));
  add('POST', '/api/threads/:kidId/:adultId/read', (c, h) => X.readThread(h.core, c, P(h, 'kidId'), P(h, 'adultId')));
  add('GET', '/api/kid-threads', (c, h) => X.listKidThreads(h.core, c, h.query.kidId));
  add('GET', '/api/kid-threads/:kidId/:otherId', (c, h) => X.getKidThread(h.core, c, P(h, 'kidId'), P(h, 'otherId')));
  add('POST', '/api/kid-threads/:kidId/:otherId/read', (c, h) => X.readKidThread(h.core, c, P(h, 'kidId'), P(h, 'otherId')));
  add('GET', '/api/kid-chats', (c, h) => X.listKidChats(h.core, c));
  add('GET', '/api/kid-chats/:a/:b', (c, h) => X.peekKidChat(h.core, c, P(h, 'a'), P(h, 'b')));
  add('POST', '/api/kid-messages', (c, h) => ({ status: 201, body: X.sendKidMessage(h.core, c, h.body) }));
  add('POST', '/api/messages', (c, h) => ({ status: 201, body: X.sendMessage(h.core, c, h.body) }));
  add('GET', '/api/notifications', (c, h) => X.listNotifications(h.core, c, h.query.kidId));
  add('POST', '/api/notifications/read-all', (c, h) => X.readAllNotifications(h.core, c, h.query.kidId));
  add('GET', '/api/notifications/:id', (c, h) => X.getNotification(h.core, c, P(h)));
  add('POST', '/api/notifications/:id/read', (c, h) => X.markNotification(h.core, c, P(h)));
  add('GET', '/api/push/key', (c, h) => ({ publicKey: app.vapidPublicKey || null }));
  add('POST', '/api/push/subscribe', (c, h) => X.subscribePush(h.core, c, h.body.subscription));
  add('POST', '/api/push/test', (c, h) => X.testPush(h.core, c));
  add('POST', '/api/push/unsubscribe', (c, h) => X.unsubscribePush(h.core, c, h.body.endpoint));
  // ---- 활동 타이머 ----
  add('GET', '/api/activities', (c, h) => T.listActivities(h.core, c));
  add('POST', '/api/activities', (c, h) => ({ status: 201, body: T.createActivity(h.core, c, h.body) }));
  add('PATCH', '/api/activities/:id', (c, h) => T.updateActivity(h.core, c, P(h), h.body));
  add('DELETE', '/api/activities/:id', (c, h) => T.deleteActivity(h.core, c, P(h)));
  add('GET', '/api/timers', (c, h) => T.listTimers(h.core, c));
  add('POST', '/api/kids/:id/timers', (c, h) => ({ status: 201, body: T.startTimer(h.core, c, P(h), h.body) }));
  add('POST', '/api/timers/:id/dismiss', (c, h) => T.dismissTimer(h.core, c, P(h)));
  add('GET', '/api/kids/:id/activity-budget', (c, h) => T.listBudgets(h.core, c, P(h)));
  add('POST', '/api/timers/:id/pause', (c, h) => T.pauseTimer(h.core, c, P(h)));
  add('POST', '/api/timers/:id/resume', (c, h) => T.resumeTimer(h.core, c, P(h)));
  add('POST', '/api/timers/:id/cancel', (c, h) => T.cancelTimer(h.core, c, P(h)));
  add('POST', '/api/timers/:id/extend', (c, h) => T.extendTimer(h.core, c, P(h), h.body));
  add('PUT', '/api/timers/:id/next', (c, h) => T.setNext(h.core, c, P(h), h.body));

  // ---- 내일 준비물 ----
  add('GET', '/api/kids/:id/timetable', (c, h) => TT.listTimetable(h.core, c, P(h)));
  add('POST', '/api/kids/:id/timetable', (c, h) => ({ status: 201, body: TT.createTimetable(h.core, c, P(h), h.body) }));
  add('GET', '/api/kids/:id/meals', (c, h) => ML.listMeals(h.core, c, P(h), h.query));
  add('POST', '/api/kids/:id/meals/import', (c, h) => ML.importMeals(h.core, c, P(h), h.body));
  add('PUT', '/api/kids/:id/meals/:date', (c, h) => ML.setMeal(h.core, c, P(h), h.params.date, h.body));
  add('DELETE', '/api/kids/:id/meals/:date', (c, h) => ML.deleteMeal(h.core, c, P(h), h.params.date));
  add('GET', '/api/meals/alert', (c, h) => ML.getAlert(h.core, c));
  add('POST', '/api/meals/alert/test', (c, h) => ML.testAlert(h.core, c));
  add('PUT', '/api/meals/alert', (c, h) => ML.setAlert(h.core, c, h.body));
  add('PATCH', '/api/timetable/:id', (c, h) => TT.updateTimetable(h.core, c, P(h), h.body));
  add('DELETE', '/api/timetable/:id', (c, h) => TT.deleteTimetable(h.core, c, P(h)));
  add('POST', '/api/supplies', (c, h) => ({ status: 201, body: SP.createSupplies(h.core, c, h.body) }));
  add('GET', '/api/kids/:id/supplies', (c, h) => SP.listSupplies(h.core, c, P(h)));
  add('PUT', '/api/supplies/:id/kids/:kidId', (c, h) => SP.setChecked(h.core, c, P(h), P(h, 'kidId'), h.body.checked));
  add('DELETE', '/api/supplies/:id', (c, h) => SP.deleteSupply(h.core, c, P(h)));

  // ---- 이번 주 가족 활동 ----
  add('GET', '/api/family-activities', (c, h) => FA.famActSummary(h.core, c));
  add('POST', '/api/family-activities/options', (c, h) => ({ status: 201, body: FA.addOption(h.core, c, h.body) }));
  add('DELETE', '/api/family-activities/options/:id', (c, h) => FA.removeOption(h.core, c, P(h)));
  add('PUT', '/api/kids/:id/family-pick', (c, h) => FA.pick(h.core, c, P(h), h.body.optionId ?? null));
  add('POST', '/api/family-activities/plans', (c, h) => FA.confirmPlan(h.core, c, h.body));
  add('DELETE', '/api/family-activities/plans/:id', (c, h) => FA.cancelPlan(h.core, c, P(h)));
  void fs;
  return r;
}
