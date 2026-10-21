import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KafkaProducerModule } from '../kafka/kafka-producer.module';
import { BillingAccount, BillingAccountSchema } from './billing.schema';
import { BillingConsumer } from './billing.consumer';
import { BillingService } from './billing.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BillingAccount.name, schema: BillingAccountSchema },
    ]),
    KafkaProducerModule,
  ],
  controllers: [BillingConsumer],
  providers: [BillingService],
})
export class BillingModule {}
