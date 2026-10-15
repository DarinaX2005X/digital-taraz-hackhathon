'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useIdentityNavigationGuard } from '@/features/identity/ui/navigation-guard';
import { Button, Dialog, DialogClose } from '@/ui';
import { useWorkspaceCopy } from './shell';

export function useWorkspaceLeaveGuard(dirty: boolean, blocked = false) {
  const navigation = useIdentityNavigationGuard(dirty, false, blocked);
  const t = useWorkspaceCopy();
  const [confirming, setConfirming] = useState(false);
  const resolve = useRef<((leave: boolean) => void) | undefined>(undefined);
  useEffect(() => () => { resolve.current?.(false); }, []);
  function decide(leave: boolean) { resolve.current?.(leave); resolve.current = undefined; setConfirming(false); }
  function beforeSignOut() {
    if (blocked) return Promise.resolve(false);
    if (!dirty) return Promise.resolve(true);
    resolve.current?.(false);
    return new Promise<boolean>((done) => { resolve.current = done; setConfirming(true); });
  }
  return { onClickCapture: navigation.onClickCapture, beforeSignOut, confirmation: <>
    {navigation.confirmation}
    <Dialog open={confirming} onOpenChange={(open) => { if (!open) decide(false); }} title={t.unsaved} description={t.leaveDescription} footer={<>
      <DialogClose icon={ArrowLeft}>{t.stay}</DialogClose>
      <Button icon={ArrowRight} variant="danger" onClick={() => decide(true)}>{t.discardAndLeave}</Button>
    </>}>{null}</Dialog>
  </> };
}
