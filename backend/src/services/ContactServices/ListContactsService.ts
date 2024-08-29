import { Sequelize, Op, Filterable } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ContactTag from "../../models/ContactTag";

import { intersection } from "lodash";
import Tag from "../../models/Tag";
import removeAccents from "remove-accents";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  companyId: number;
  tagsIds?: number[];
  isGroup?: string;
}

interface Response {
  contacts: Contact[];
  count: number;
  hasMore: boolean;
}

const ListContactsService = async ({
  searchParam = "",
  pageNumber = "1", 
  companyId,
  tagsIds,
  isGroup
}: Request): Promise<Response> => {
  const sanitizedSearchParam = removeAccents(searchParam.toLocaleLowerCase().trim());

   let whereCondition: Filterable["where"] = {
    [Op.or]: [
      {
        name: Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("Contact.name")),
          "LIKE",
          `%${sanitizedSearchParam}%`
        )
      },
      { number: { [Op.like]: `%${sanitizedSearchParam}%` } }
    ]
  };

  whereCondition = {
    ...whereCondition,
    companyId
  };

  
  if (Array.isArray(tagsIds) && tagsIds.length > 0) {
    const contactTagFilter: any[] | null = [];
    // for (let tag of tags) {
    const contactTags = await ContactTag.findAll({
      where: { tagId: { [Op.in]: tagsIds } }
    });
    if (contactTags) {
      contactTagFilter.push(contactTags.map(t => t.contactId));
    }
    // }

    const ticketsIntersection: number[] = intersection(...contactTagFilter);

    whereCondition = {
      ...whereCondition,
      id: {
        [Op.in]: ticketsIntersection
      }
    };
  }

  if (isGroup === "false") {
    whereCondition = {
      ...whereCondition,
      isGroup: false
    }
  }


  const limit = 100;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: contacts } = await Contact.findAndCountAll({
    where: whereCondition,
    limit,
    include: [
      {
        model: Ticket,
        as: "tickets",
        attributes: ["id", "status", "createdAt", "updatedAt"]
      },   
      {
        model: Tag,
        as: "tags",
        //include: ["tags"]
      }
    ],
    offset,
    order: [["name", "ASC"]]
  });

  const hasMore = count > offset + contacts.length;

  return {
    contacts,
    count,
    hasMore
  };
};

export default ListContactsService;
