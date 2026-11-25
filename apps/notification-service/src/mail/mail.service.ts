import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export type EmailContent = {
  to: string;
  subject: string;
  text: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    // Mailpit no usa TLS ni autenticación: es un SMTP de laboratorio.
    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: Number(config.getOrThrow<string>('SMTP_PORT')),
      secure: false,
    });
    this.from = config.get<string>('SMTP_FROM') ?? 'no-reply@demo.local';
  }

  async send(email: EmailContent) {
    const info = await this.transporter.sendMail({
      from: this.from,
      ...email,
    });

    this.logger.log(
      `Email enviado a ${email.to} (messageId=${info.messageId}, asunto="${email.subject}")`,
    );

    return info;
  }
}
