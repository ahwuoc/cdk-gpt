import { Schema, model, models } from 'mongoose';
import type { HydratedDocument, Types, Model } from 'mongoose';
import { baseSchemaOptions, objectId, softDelete } from './common';

export const TicketStatus = { OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', WAITING_USER: 'WAITING_USER', RESOLVED: 'RESOLVED', CLOSED: 'CLOSED' } as const;
export const TicketPriority = { LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export interface SupportMessage { senderType: 'USER' | 'ADMIN'; senderId: Types.ObjectId; body: string; createdAt: Date; }
export interface SupportTicket {
  ticketCode: string; userId: Types.ObjectId; subject: string; category: string;
  status: typeof TicketStatus[keyof typeof TicketStatus]; priority: typeof TicketPriority[keyof typeof TicketPriority];
  assignedAdminId?: Types.ObjectId; messages: SupportMessage[]; createdAt: Date; updatedAt: Date; deletedAt: Date | null;
}
const SupportMessageSchema = new Schema<SupportMessage>({
  senderType: { type: String, enum: ['USER', 'ADMIN'], required: true }, senderId: objectId(undefined, true),
  body: { type: String, required: true, maxlength: 10_000 }, createdAt: { type: Date, default: Date.now, required: true },
}, { _id: true });
export const SupportTicketSchema = new Schema<SupportTicket>({
  ticketCode: { type: String, required: true, uppercase: true }, userId: objectId('User', true),
  subject: { type: String, required: true, trim: true, maxlength: 300 }, category: { type: String, required: true, trim: true, maxlength: 80 },
  status: { type: String, enum: Object.values(TicketStatus), default: TicketStatus.OPEN },
  priority: { type: String, enum: Object.values(TicketPriority), default: TicketPriority.NORMAL },
  assignedAdminId: objectId('Admin'), messages: { type: [SupportMessageSchema], default: [] }, deletedAt: softDelete,
}, baseSchemaOptions);
SupportTicketSchema.index({ ticketCode: 1 }, { unique: true });
SupportTicketSchema.index({ userId: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ assignedAdminId: 1, status: 1, updatedAt: -1 });
export const SupportTicketModel: Model<SupportTicket> = (models.SupportTicket as Model<SupportTicket> | undefined) ?? model<SupportTicket>('SupportTicket', SupportTicketSchema, 'support_tickets');
