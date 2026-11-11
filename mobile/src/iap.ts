// Bridge between the StoreKit module (modules/skcal-iap) and the worker.
//
// skcal is free and sells nothing in the app. What is left here keeps App Store
// subscriptions bought before that in sync: StoreKit delivers renewals,
// refunds, and revocations to the app, each goes to POST /api/apple/verify
// (which re-reads it from Apple), and a transaction is only finished once the
// worker has answered.
//
// Every entry point is safe when StoreKit is unavailable (Android, the web
// preview, Expo Go): the module answers with empty lists and no events.

import { appleVerify } from "./api";
import {
  addTransactionListener,
  finishTransaction,
  getUnfinishedTransactions,
  type SkcalTransaction,
} from "../modules/skcal-iap";

/**
 * Verify one transaction with the worker and, if the worker accepted it, finish
 * it with StoreKit. Finishing is what stops Apple redelivering it forever, so it
 * happens for a verified refund too, not just a verified renewal. Returns
 * whether the worker was told.
 */
async function verifyAndFinish(transaction: SkcalTransaction): Promise<boolean> {
  if (!transaction.transactionId) return false;
  try {
    await appleVerify(transaction.transactionId);
    await finishTransaction(transaction.transactionId);
    return true;
  } catch {
    // Leave the transaction unfinished so the next launch retries it.
    return false;
  }
}

/**
 * Re-verify anything StoreKit still considers unfinished: a renewal that landed
 * while the verify call was failing, or one that arrived while the app was
 * closed.
 */
export async function reconcilePendingTransactions(): Promise<void> {
  for (const transaction of await getUnfinishedTransactions()) {
    await verifyAndFinish(transaction);
  }
}

/**
 * Watch Transaction.updates so a renewal, refund, or revocation that happens
 * while the app is open reaches the worker immediately instead of waiting for
 * the next App Store Server Notification. `onChange` fires after the worker has
 * been told, so the caller can refetch.
 */
export function watchTransactions(onChange: () => void): () => void {
  const subscription = addTransactionListener((transaction) => {
    // "unverified" means StoreKit itself could not check the signature; there is
    // nothing to send the worker.
    if (transaction.state === "unverified" || !transaction.transactionId) return;
    void verifyAndFinish(transaction).then((told) => {
      if (told) onChange();
    });
  });
  return () => subscription.remove();
}
