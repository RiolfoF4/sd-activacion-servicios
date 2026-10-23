import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KafkaProducerModule } from '../kafka/kafka-producer.module';
import {
  ProvisioningOrder,
  ProvisioningOrderSchema,
} from './provisioning.schema';
import { ProvisioningConsumer } from './provisioning.consumer';
import { ProvisioningService } from './provisioning.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProvisioningOrder.name, schema: ProvisioningOrderSchema },
    ]),
    KafkaProducerModule,
  ],
  controllers: [ProvisioningConsumer],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
