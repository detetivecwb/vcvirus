import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { Op } from "sequelize";
import { intersection } from "lodash";
import User from "../../models/User";

interface Request {
  ticketId: string;
  companyId: number;
  pageNumber?: string;
  queues?: number[];
  user?: User;
}

interface Response {
  messages: Message[];
  ticket: Ticket;
  count: number;
  hasMore: boolean;
}

const ListMessagesService = async ({
  pageNumber = "1",
  ticketId,
  companyId,
  queues = [],
  user
}: Request): Promise<Response> => {
  const ticket = await ShowTicketService(ticketId, companyId);

  // console.log(queues)

  // const ticketsFilter: any[] | null = [];

  // const ticketIds = await Ticket.findAll({
  //   where: { 
  //     status: 'closed', 
  //     queueId: 
  //       user.profile === "admin" ? 
  //         {[Op.or]: {
  //           [Op.in]: queues,
  //           [Op.eq]: null
  //         }} : 
  //         {[Op.in]: queues},
  //     contactId: ticket.contactId,
  //     whatsappId: ticket.whatsappId,
  //     companyId
  //   },
  // });

  // if (ticketIds) {
  //   ticketsFilter.push(ticketIds.map(t => t.id));
  // }
  // // }

  // const tickets: number[] = intersection(...ticketsFilter);
  // console.log(ticketsFilter)
  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  // await setMessagesAsRead(ticket);
  const limit = 20;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: messages } = await Message.findAndCountAll({
    //where: { ticketId },
    limit,
    include: [
      "contact",
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"]
      },
      {
        model: Ticket,
        where: {
          contactId: ticket.contactId,
          whatsappId: ticket.whatsappId,
          isGroup: ticket.isGroup,
          queueId: user.profile === "admin" || user.allTicket  === "enable" ? 
          {[Op.or]: {
            [Op.in]: queues,
            [Op.eq]: null
          }} : 
          {[Op.in]: queues},
        },
        required: true,
        include: ["queue"],
      }
    ],
    offset,
    order: [["createdAt", "DESC"]]
  });

  const hasMore = count > offset + messages.length;

  return {
    messages: messages.reverse(),
    ticket,
    count,
    hasMore
  };
};

export default ListMessagesService;