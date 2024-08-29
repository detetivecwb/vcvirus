import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import CreateLogTicketService from "./CreateLogTicketService";

const DeleteTicketService = async (id: string, userId: string, companyId: number): Promise<Ticket> => {
  const ticket = await Ticket.findOne({
    where: { id }
  });

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  await ticket.destroy();

  await CreateLogTicketService({
    userId,
    ticketId: ticket.id,
    type: "delete"
  });

  return ticket;
};

export default DeleteTicketService;
