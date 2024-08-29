import Contact from "../../models/Contact";

type Param = {
    companyId: number
  };

const FindAllContactService = async ({
    companyId
  }: Param): Promise<Contact[]> => {
    let where: any = {
        companyId
      };
  const contacts = await Contact.findAll({
    where,
    order: [["name", "ASC"]]
  });
  return contacts;
};

export default FindAllContactService;