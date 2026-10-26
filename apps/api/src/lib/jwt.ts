import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export interface OwnerClaims {
  kind: 'owner';
  /** user id */
  sub: string;
  /** outlet id */
  oid: string;
  role: 'owner' | 'manager';
}

export interface EmployeeClaims {
  kind: 'employee';
  /** employee id */
  sub: string;
  /** device id */
  did: string;
  /** outlet id */
  oid: string;
  role: 'cashier';
  /** session id */
  jti: string;
}

export type TokenClaims = OwnerClaims | EmployeeClaims;

const ISSUER = 'kelola-kasir';
const ALG = 'EdDSA';

export class TokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(privateKeyPem: string) {
    this.privateKey = createPrivateKey(privateKeyPem);
    this.publicKey = createPublicKey(this.privateKey);
  }

  signOwner(claims: Omit<OwnerClaims, 'kind'>, ttlSec: number): Promise<string> {
    return new SignJWT({ kind: 'owner', oid: claims.oid, role: claims.role })
      .setProtectedHeader({ alg: ALG })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience('owner')
      .setIssuedAt()
      .setExpirationTime(`${ttlSec}s`)
      .sign(this.privateKey);
  }

  signEmployee(claims: Omit<EmployeeClaims, 'kind' | 'role'>, ttlSec: number): Promise<string> {
    return new SignJWT({ kind: 'employee', did: claims.did, oid: claims.oid, role: 'cashier' })
      .setProtectedHeader({ alg: ALG })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setIssuer(ISSUER)
      .setAudience('employee')
      .setIssuedAt()
      .setExpirationTime(`${ttlSec}s`)
      .sign(this.privateKey);
  }

  /** Returns the verified claims, or `null` if the token is malformed, expired or forged. */
  async verify(token: string): Promise<TokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: ISSUER,
        algorithms: [ALG],
      });
      const sub = payload.sub;
      const oid = payload['oid'];
      if (typeof sub !== 'string' || typeof oid !== 'string') return null;
      if (payload['kind'] === 'owner' && payload.aud === 'owner') {
        const role = payload['role'];
        if (role !== 'owner' && role !== 'manager') return null;
        return { kind: 'owner', sub, oid, role };
      }
      if (payload['kind'] === 'employee' && payload.aud === 'employee') {
        const did = payload['did'];
        if (typeof did !== 'string' || typeof payload.jti !== 'string') return null;
        return { kind: 'employee', sub, oid, did, role: 'cashier', jti: payload.jti };
      }
      return null;
    } catch {
      return null;
    }
  }
}
