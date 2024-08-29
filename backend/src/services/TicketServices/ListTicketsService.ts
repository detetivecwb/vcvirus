import { Op, fn, where, col, Filterable, Includeable, literal } from "sequelize";
import { startOfDay, endOfDay, parseISO } from "date-fns";

import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import User from "../../models/User";
import ShowUserService from "../UserServices/ShowUserService";
import Tag from "../../models/Tag";

import { intersection } from "lodash";
import Whatsapp from "../../models/Whatsapp";
import ContactTag from "../../models/ContactTag";

import removeAccents from "remove-accents"

interface Request {
  searchParam?: string;
  pageNumber?: string;
  status?: string;
  date?: string;
  dateStart?: string;
  dateEnd?: string;
  updatedAt?: string;
  showAll?: string;
  userId: string;
  withUnreadMessages?: string;
  queueIds: number[];
  tags: number[];
  users: number[];
  contacts?: string[];
  updatedStart?: string;
  updatedEnd?: string;
  connections?: string[];
  whatsappIds?: number[];
  statusFilters?: string[];
  queuesFilter?: string[];
  isGroup?: string;
  companyId: number;
  allTicket?: string;
}

interface Response {
  tickets: Ticket[];
  count: number;
  hasMore: boolean;
}

const ListTicketsService = async ({
  searchParam = "",
  pageNumber = "1",
  queueIds,
  tags,
  users,
  status,
  date,
  dateStart,
  dateEnd,
  updatedAt,
  showAll,
  userId,
  withUnreadMessages,
  whatsappIds,
  statusFilters,
  companyId
}: Request): Promise<Response> => {

  let whereCondition: Filterable["where"] = {
    [Op.or]: [{ userId }, { status: "pending" }],
    queueId: {[Op.or]: [queueIds, null]},
    companyId
  };

  let includeCondition: Includeable[];

  includeCondition = [
    {
      model: Contact,
      as: "contact",
      attributes: ["id", "name", "number", "email", "profilePicUrl", "acceptAudioMessage", "active", "urlPicture", "companyId"],
      include: ["extraInfo", "contactTags", "tags"]
    },
    {
      model: Queue,
      as: "queue",
      attributes: ["id", "name", "color"]
    },
    {
      model: User,
      as: "user",
      attributes: ["id", "name"]
    },
    {
      model: Tag,
      as: "tags",
      attributes: ["id", "name", "color"]
    },
    {
      model: Whatsapp,
      as: "whatsapp",
      attributes: ["id", "name", "expiresTicket"]
    },    
  ];
  const user = await ShowUserService(userId);
  const userQueueIds = user.queues.map(queue => queue.id);

  if ( status === "open" ) {
    whereCondition = {
      ...whereCondition,
      userId,
      queueId: { [Op.in] : queueIds}
    };
  }
  
  if ( status === "group" && (user.allowGroup  || showAll === "true" )) {
    whereCondition = {
      ...whereCondition,
      queueId: { [Op.or]: [queueIds, null] },
    };
  }

  if (user.profile === "user" && status === "pending" && user.allTicket === "enable") {
    const TicketsUserFilter: any[] | null = [];
    const maxTicketIds = await Ticket.findAll({
      where: {
        userId: {[Op.or] : [user.id, null ]},
        queueId: { [Op.or]: [queueIds, null] },
        status: "pending"
      },
    });
    if (maxTicketIds) {
      TicketsUserFilter.push(maxTicketIds.map(t => t.id));
    }
    // }

    const ticketsIntersection: number[] = intersection(...TicketsUserFilter);

    whereCondition = {
      ...whereCondition,
      id: {[Op.in] : ticketsIntersection}
    };
  }


  if (user.profile === "user" && status === "pending" && user.allTicket === "disable") {
    const TicketsUserFilter: any[] | null = [];
    const maxTicketIds = await Ticket.findAll({
      where: {
        [Op.or] : 
          [{ userId: 
            {[Op.or] : [user.id, null ]}
           }, 
           {status: {[Op.or]: ["pending","closed"]}
           }
          ],
        queueId: { [Op.in] : queueIds},
        status: "pending"
      },
    });

    if (maxTicketIds) {
      TicketsUserFilter.push(maxTicketIds.map(t => t.id));
    }
    // }

    const ticketsIntersection: number[] = intersection(...TicketsUserFilter);

    whereCondition = {
      ...whereCondition,
      id: {[Op.in] : ticketsIntersection}
    };
  }

  if (showAll === "true" && user.profile === "admin") {
    whereCondition = { queueId: { [Op.or]: [queueIds, null] } };
  }

  
  if (status && status !== "search" ) {
    whereCondition = {
      ...whereCondition,
      status
    };
  }

  if (status === "closed") {
    // const maxTicketsFilter: any[] | null = [];
    // const maxTicketIds = await Ticket.findAll({
    //   where: {       
    //     queueId: showAll === "true" || user.allTicket === "enable" ? { [Op.or]: [queueIds, null] } : queueIds,
    //     status: "closed"
    //   },
    //   group: ['companyId','contactId', 'whatsappId'],
    //   attributes: ['companyId','contactId', 'whatsappId', [ fn('max', col('id')), 'id']],
    // });
    // if (maxTicketIds) {
    //   maxTicketsFilter.push(maxTicketIds.map(t => t.id));
    // }
    // // }

    // const contactsIntersection: number[] = intersection(...maxTicketsFilter);

    // whereCondition = {
    //   ...whereCondition,
    //   id: {
    //     [Op.in]: contactsIntersection
    //   }
    // };
    const latestTickets = await Ticket.findAll({
      attributes: ['companyId', 'contactId', 'whatsappId', [literal('MAX("id")'), 'id']],
      where: {
        queueId: showAll === "true" || user.allTicket === "enable" ? { [Op.or]: [queueIds, null] } : queueIds,
        status: "closed",
      },
      group: ['companyId', 'contactId', 'whatsappId'],
    });
  
    const ticketIds = latestTickets.map((t) => t.id);
  
    whereCondition = {
      ...whereCondition,
      id: {
        [Op.in]: ticketIds,
      },
    };
  }

  if (status === "search") {
    whereCondition = {
      companyId
    }
    const latestTickets = await Ticket.findAll({
      attributes: ['companyId', 'contactId', 'whatsappId', [literal('MAX("id")'), 'id']],
      where: {
        queueId: showAll === "true" || user.allTicket === "enable" ? { [Op.or]: [queueIds, null] } : queueIds,
      },
      group: ['companyId', 'contactId', 'whatsappId'],
    });
  
    const ticketIds = latestTickets.map((t) => t.id);
  
    whereCondition = {
      ...whereCondition,
      id: {
        [Op.in]: ticketIds,
      },
    };

    // if (date) {
    //   whereCondition = {
    //     createdAt: {
    //       [Op.between]: [+startOfDay(parseISO(date)), +endOfDay(parseISO(date))]
    //     }
    //   };
    // }

    // if (dateStart && dateEnd) {
    //   whereCondition = {
    //     updatedAt: {
    //       [Op.between]: [+startOfDay(parseISO(dateStart)), +endOfDay(parseISO(dateEnd))]
    //     }
    //   };
    // }

    // if (updatedAt) {
    //   whereCondition = {
    //     updatedAt: {
    //       [Op.between]: [
    //         +startOfDay(parseISO(updatedAt)),
    //         +endOfDay(parseISO(updatedAt))
    //       ]
    //     }
    //   };
    // }

   
    if (searchParam) {
      const sanitizedSearchParam = removeAccents(searchParam.toLocaleLowerCase().trim());
  
      includeCondition = [
        ...includeCondition,
        {
          model: Message,
          as: "messages",
          attributes: ["id", "body"],
          where: {
            body:  where(
              fn("LOWER", fn('unaccent',col("body"))),
              "LIKE",
              `%${sanitizedSearchParam}%`
            )
          },
          required: false,
          duplicating: false
        }
      ];     

      whereCondition = {
        ...whereCondition,
        [Op.or]: [
          {
            "$contact.name$": where(
              fn("LOWER", fn("unaccent", col("contact.name"))),
              "LIKE",
              `%${sanitizedSearchParam}%`
            )
          },
          { "$contact.number$": { [Op.like]: `%${sanitizedSearchParam}%` } },
          {
            "$message.body$": where(
              fn("LOWER", fn("unaccent",col("body"))),
              "LIKE",
              `%${sanitizedSearchParam}%`
            )
          }
        ]
      };

    }
    
    if (Array.isArray(tags) && tags.length > 0) {
      const contactTagFilter: any[] | null = [];
      // for (let tag of tags) {
      const contactTags = await ContactTag.findAll({
        where: { tagId: { [Op.in]: tags } }
      });
      if (contactTags) {
        contactTagFilter.push(contactTags.map(t => t.contactId));
      }
      // }
  
      const contactsIntersection: number[] = intersection(...contactTagFilter);
  
      whereCondition = {
        ...whereCondition,
        contactId: {
          [Op.in]: contactsIntersection
        }
      };
    }
    
    if (Array.isArray(users) && users.length > 0) {
      whereCondition = {
        ...whereCondition,
        userId: {[Op.in]:users} 
      };
    }
  
    
    if (Array.isArray(whatsappIds) && whatsappIds.length > 0) {
      whereCondition = {
        ...whereCondition,
        whatsappId: {[Op.in]:whatsappIds}
      };
    }
  
    if (Array.isArray(statusFilters) && statusFilters.length > 0) {
      whereCondition = {
        ...whereCondition,
        status: {[Op.in]:statusFilters}
      };
    }

  }

  if (withUnreadMessages === "true") {
    whereCondition = {
      [Op.or]: [
        { userId, 
          status: {
            [Op.notIn] : ["closed", "lgpd", "nps"] 
          },
          queueId: {[Op.in] : userQueueIds},
          unreadMessages: { [Op.gt]: 0 },
          companyId
        }, 
        { 
          status: {
            [Op.in] : ["pending","group"] 
          },
          queueId: { [Op.or]: [userQueueIds, null] },
          unreadMessages: { [Op.gt]: 0 },
          companyId 
        }
      ]
    };

    if ( status === "group" && (user.allowGroup  || showAll === "true" )) {
      whereCondition = {
        ...whereCondition,
        queueId: { [Op.or]: [userQueueIds, null] },
      };
    }
  }

  whereCondition = {
    ...whereCondition,
    companyId
  };
    
  const limit = 40;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: tickets } = await Ticket.findAndCountAll({
    where: whereCondition,
    include: includeCondition,
    distinct: true,    
    limit,
    offset,
    order: [["updatedAt", "DESC"]],
    subQuery: false
  });

  const hasMore = count > offset + tickets.length;

  return {
    tickets,
    count,
    hasMore
  };
};

export default ListTicketsService;
