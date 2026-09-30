-- Running work remains CANCELLING until its executor acknowledges shutdown.
ALTER TYPE "CommandRequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLING' BEFORE 'COMPLETED';
