import AppError from "../../errors/AppError";

import { Op } from "sequelize";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import GetDefaultWhatsAppByUser from "../../helpers/GetDefaultWhatsAppByUser";
import Ticket from "../../models/Ticket";
import ShowContactService from "../ContactServices/ShowContactService";
import { getIO } from "../../libs/socket";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import Queue from "../../models/Queue";
import User from "../../models/User";
import CheckContactOpenTickets from "../../helpers/CheckContactOpenTickets";

import CreateLogTicketService from "./CreateLogTicketService";

interface Request {
  contactId: number;
  status: string;
  userId: number;
  companyId: number;
  queueId?: number;
  whatsappId?: string;
}

const CreateTicketService = async ({
  contactId,
  status,
  userId,
  queueId,
  companyId,
  whatsappId
}: Request): Promise<Ticket> => {
  
  const io = getIO();

  console.log(
    contactId,
    status,
    userId,
    queueId,
    companyId,
    whatsappId
  )
  let whatsapp;

  if (whatsappId !== undefined && whatsappId !== null && whatsappId !==  "") {
    whatsapp = await ShowWhatsAppService(whatsappId, companyId)
  }
  
  let defaultWhatsapp = await GetDefaultWhatsAppByUser(userId);

  if (whatsapp) {
    defaultWhatsapp = whatsapp;
  }
  if (!defaultWhatsapp)
    defaultWhatsapp = await GetDefaultWhatsApp(companyId);
    
  await CheckContactOpenTickets(contactId, defaultWhatsapp.id);
  
  const { isGroup } = await ShowContactService(contactId, companyId);

  const [{ id }] = await Ticket.findOrCreate({
    where: {
      contactId,
      companyId,
      whatsappId: defaultWhatsapp.id
    },
    defaults: {
      contactId,
      companyId,
      status,
      whatsappId: defaultWhatsapp.id,
      isGroup,
      userId,
      isBot: true,
    }
  });

  await Ticket.update(
    { companyId, queueId, userId, status: isGroup? "group": "open", isBot: true },
    { where: { id } }
  );

  const ticket = await Ticket.findByPk(id, { include: ["contact", "queue"] });

  if (!ticket) {
    throw new AppError("ERR_CREATING_TICKET");
  }

  io.to(ticket.status)
      .to("notification")
      .to(id.toString())
      .emit(`company-${companyId}-ticket`, {
        action: "update",
        ticket
    });

  await CreateLogTicketService({
    userId,
    queueId,
    ticketId: ticket.id,
    type: "create"
  });

  return ticket;
};

export default CreateTicketService;
