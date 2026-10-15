'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { LoadingState } from '@/ui';
import { sourceClient } from '../client/transport';
import { SourceError, useSourceCopy } from './common';
import styles from './sources.module.css';

export function PrivateSourceImage({ workspaceId, uploadId, ownerId, fileName, run, page }: { workspaceId: string; uploadId: string; ownerId: string; fileName: string; page?: number; run: <T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T> }) {
  const t = useSourceCopy(), [url, setUrl] = useState<string>(), [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController(); let objectUrl: string | undefined;
    void run((signal) => page === undefined ? sourceClient.image(workspaceId, uploadId, { userId: ownerId, signal }) : sourceClient.pageImage(workspaceId, uploadId, page, { userId: ownerId, signal }), controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [workspaceId, uploadId, ownerId, run, page]);
  if (error) return <SourceError error={error} />;
  return <div className={styles.imagePreview}>{url ? <Image src={url} alt={fileName} fill unoptimized sizes="100vw" /> : <LoadingState label={t.loading} />}</div>;
}
