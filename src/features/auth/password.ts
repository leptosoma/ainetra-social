import { compare, hash } from "bcryptjs";

const PASSWORD_COST = 12;

export function hashPassword(password: string) {
  return hash(password, PASSWORD_COST);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}
