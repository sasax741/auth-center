export class CreateUserDto {
  name: string;
  lastName: string;
  email: string;
  password: string | null;
  client: string;
  provider?: string;
  emailVerifiedAt?: Date;
}
