import { ObjectId } from 'mongodb';

export interface AccountDoc {
  _id?: ObjectId | string;
  raw: string;
  email: string;
  password: string;
  token: string;
  accountId: string;
  type: string; // e.g. 'PLUS', 'PRO', 'STANDARD'
  status: 'available' | 'used';
  usedByCdk?: string | null;
  createdAt: Date;
  usedAt?: Date | null;
}

export interface CdkDoc {
  _id?: ObjectId | string;
  code: string;
  type: string; // e.g. 'PLUS', 'PRO', 'STANDARD'
  status: 'unused' | 'redeemed';
  redeemedAccountId?: ObjectId | string | null;
  redeemedAccountData?: string | null;
  note?: string | null;
  createdAt: Date;
  redeemedAt?: Date | null;
}

export interface ParsedAccount {
  raw: string;
  email: string;
  password: string;
  token: string;
  accountId: string;
  isValid: boolean;
}

/**
 * Smartly parses account lines in multiple formats:
 * 1. email----password----accountId----token (e.g. LeoSolis1430@outlook.com----pass----uuid----token)
 * 2. email|password|token|accountId
 * 3. email:password:token:accountId
 */
export function parseAccountLine(rawLine: string): ParsedAccount {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return { raw: trimmed, email: '', password: '', token: '', accountId: '', isValid: false };
  }

  let parts: string[] = [];
  if (trimmed.includes('----')) {
    parts = trimmed.split(/----+/).map((p) => p.trim());
  } else if (trimmed.includes('|')) {
    parts = trimmed.split('|').map((p) => p.trim());
  } else if (trimmed.includes(':')) {
    parts = trimmed.split(':').map((p) => p.trim());
  } else if (trimmed.includes('\t')) {
    parts = trimmed.split('\t').map((p) => p.trim());
  } else {
    parts = [trimmed];
  }

  if (parts.length >= 4) {
    const email = parts[0];
    const password = parts[1];
    let fieldA = parts[2];
    let fieldB = parts.slice(3).join('|').trim();

    let token = fieldA;
    let accountId = fieldB;

    // Smart detect: If fieldA is UUID (e.g. 9e5f94bc-e8a4-4e73-b8be-63364c29d753)
    // and fieldB is long token (e.g. M.C504_BAY...), swap them!
    const isFieldAUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fieldA);
    const isFieldBToken = fieldB.startsWith('M.') || fieldB.length > 50;

    if (isFieldAUuid || isFieldBToken) {
      accountId = fieldA;
      token = fieldB;
    }

    return {
      raw: trimmed,
      email,
      password,
      token,
      accountId,
      isValid: Boolean(email && email.includes('@')),
    };
  }

  if (parts.length >= 2) {
    return {
      raw: trimmed,
      email: parts[0] || '',
      password: parts[1] || '',
      token: parts[2] || '',
      accountId: parts[3] || '',
      isValid: Boolean(parts[0] && parts[0].includes('@')),
    };
  }

  return { raw: trimmed, email: '', password: '', token: '', accountId: '', isValid: false };
}

/**
 * Generates a random CDK code with optional prefix type.
 * e.g. generateCdkCode('PLUS') -> 'PLUS-A1B2-C3D4-E5F6'
 */
export function generateCdkCode(typePrefix: string = 'PLUS'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const prefix = (typePrefix || 'PLUS').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const getRandomChunk = (len: number) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };
  return `${prefix}-${getRandomChunk(4)}-${getRandomChunk(4)}-${getRandomChunk(4)}`;
}
