import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MailClientService {
  private readonly mailServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.mailServiceUrl =
      this.configService.get<string>('MAIL_SERVICE_URL') || 'http://mail:8080';
  }

  async sendPasswordResetEmail(
    to: string,
    resetToken: string,
    callbackUrl?: string,
  ): Promise<void> {
    let body: string;

    if (callbackUrl) {
      const resetLink = `${callbackUrl}?token=${resetToken}`;
      body = `
        <h2>Password Reset</h2>
        <p>You have requested to reset your password.</p>
        <p>Click the link below to reset it:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>This link will expire in 15 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      `;
    } else {
      body = `
        <h2>Password Reset</h2>
        <p>You have requested to reset your password.</p>
        <p>Use the following token to reset it:</p>
        <p><strong>${resetToken}</strong></p>
        <p>This token will expire in 15 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      `;
    }

    await firstValueFrom(
      this.httpService.post(`${this.mailServiceUrl}/api/send`, {
        to: [to],
        subject: 'Password Reset',
        body,
        is_html: true,
      }),
    );
  }

  async sendVerificationEmail(
    to: string,
    verifyToken: string,
    callbackUrl?: string,
  ): Promise<void> {
    let body: string;

    if (callbackUrl) {
      const verifyLink = `${callbackUrl}?token=${verifyToken}`;
      body = `
        <h2>Verify Your Email</h2>
        <p>Thank you for registering.</p>
        <p>Click the link below to verify your email:</p>
        <a href="${verifyLink}">${verifyLink}</a>
        <p>This link will expire in 24 hours.</p>
        <p>If you did not create an account, please ignore this email.</p>
      `;
    } else {
      body = `
        <h2>Verify Your Email</h2>
        <p>Thank you for registering.</p>
        <p>Use the following token to verify your email:</p>
        <p><strong>${verifyToken}</strong></p>
        <p>This token will expire in 24 hours.</p>
        <p>If you did not create an account, please ignore this email.</p>
      `;
    }

    await firstValueFrom(
      this.httpService.post(`${this.mailServiceUrl}/api/send`, {
        to: [to],
        subject: 'Verify Your Email',
        body,
        is_html: true,
      }),
    );
  }
}
