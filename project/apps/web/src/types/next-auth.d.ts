import 'next-auth';

declare module 'next-auth' {
  interface Session {
    uid?: string;
    role?: 'ADMIN' | 'TEACHER' | 'STUDENT';
  }
}
