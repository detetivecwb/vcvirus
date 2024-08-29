import React, { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import makeStyles from "@mui/styles/makeStyles";
import { read, utils } from "xlsx";
import {
  Button,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import api from "../../services/api";
import upload from "../../assets/upload.gif"
import { useHistory } from "react-router-dom/cjs/react-router-dom.min";
import toastError from "../../errors/toastError";

function WorksheetToDatagrid(ws) {
  /* create an array of arrays */
  const rows = utils.sheet_to_json(ws, { header: 1 });

  /* create column array */
  const range = utils.decode_range(ws["!ref"] || "A1");
  const columns = Array.from({ length: range.e.c + 1 }, (_, i) => ({
    key: String(i), // RDG will access row["0"], row["1"], etc
    name: utils.encode_col(i), // the column labels will be A, B, etc
    //editor: textEditor // enable cell editing
  }));

  return { rows, columns }; // these can be fed to setRows / setColumns
}

const useStyles = makeStyles((theme) => ({
  xlsTable: {
    width: "100%",
  },
  tableContainer: {
    flex: 1,
    height: '520px',
    padding: 1,
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
  actions: {
    padding: 2,
    border: "1px solid #CCC",
    boxShadow: "1px 1px 5px #CCC",
    marginTop: 2,
  },
  importOptions: {
    padding: 2,
    border: "1px solid #CCC",
    boxShadow: "1px 1px 5px #CCC",
    marginTop: 2,
    marginBottom: 2,
  },
  error: {
    color: "red",
    marginTop: 1,
  },
  buttonImport: {
    marginRight: 1,
  },
  select: {
    minWidth: 200,
  },
  backButtonContainer: {
    textAlign: "center",
    marginTop: 20,
  },
}));


const ContactImport = ({ }) => {
  const [rows, setRows] = useState(null);
  const [columns, setColumns] = useState(null);
  const classes = useStyles();
  const history = useHistory();
  const [contactFieldsAvailable, setContactFieldsAvailable] = useState([]);
  const [columnValue, setColumnValue] = useState({});
  const [openingFile, setOpeningFile] = useState(false);
  const [selection, setSelection] = useState({});
  const [invalidFile, setInvalidFile] = useState(false);
  const [error, setError] = useState(null);
  const [countCreated, setCountCreated] = useState(0);
  const [countIgnored, setCountIgnored] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [imported, setImported] = useState(false);
  const [fileObjects, setFileObjects] = useState([]);

  const contactFields = [
    { id: "name", label: "Nome", required: false },
    { id: "number", label: "Número", required: true },
    { id: "email", label: "E-mail", required: false },
  ];

  useEffect(() => {
    setContactFieldsAvailable(contactFields);
  }, []);

  const processImport = async () => {
    // if (!selection.number) {
    //   setError("Não foi selecionado o campo de número do contato");
    //   return;
    // }
    setUploading(true);

    if (rows?.length > 1) {
      rows.map(async (item, index) => {
        if (index > 0) {
          setTimeout(async () => {
            const data = await api.post(`/contactsImport`, {
              name: item[0],
              number: item[1].toString(),
              email: item[3],
            });

            if (data.status === 200) {
              setCountCreated(prevCount => prevCount + 1);
            } else {
              setCountIgnored(prevCount => prevCount + 1);
            }


            setImported(true);
            setUploading(false);
          }, 330 * index);

        }
      })
    }
  };

  const onChangeFile = (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;
    setOpeningFile(true);
    setInvalidFile(false);
    setImported(false);
    setUploading(false);
    const file = acceptedFiles[0];
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = e.target.result;
        const wb = read(data);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const { rows, columns } = WorksheetToDatagrid(ws);
        setRows(rows);
        setColumns(columns);
        setOpeningFile(false);
      } catch (e) {
        console.error(e);
        setInvalidFile(true);
        setOpeningFile(false);
        setFileObjects([]);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSelectChange = (event) => {
    const value = event.target.value;
    setSelection((selection) => ({ ...selection, ...{ [value]: event.target.name } }));
    setColumnValue((columnValue) => ({ ...columnValue, ...{ [event.target.name]: event.target.value } }));
  };

  const renderSelectbox = (column) => {
    return (
      <Select value={columnValue[column.key]} name={column.key} onChange={handleSelectChange}>
        {contactFieldsAvailable.map((contactField) => (
          <MenuItem value={contactField.id}>{contactField.label}</MenuItem>
        ))}
      </Select>
    );
  };

  const renderXls = () => {
    return (
      <TableContainer className={classes.tableContainer}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>{columns.map((column) => <TableCell key={column.index}>{column.name}</TableCell>)}</TableRow>
            {/* <TableRow>{columns.map((column) => <TableCell>{renderSelectbox(column)}</TableCell>)}</TableRow> */}
          </TableHead>
          <TableBody>{rows.map((row) => <TableRow key={row.index}>{row.map((column) => <TableCell>{column}</TableCell>)}</TableRow>)}</TableBody>
        </Table>
      </TableContainer>
    );
  };

  const handleCloseImport = async () => {
    try {
      history.push('/contacts');
    } catch (err) {
      toastError(err);
    }
  };
  const renderContent = () => {
    return (
      <div>

        {renderXls()}
        <div className={classes.actions}>
          {uploading && <div>Importando... Aguarde</div>}
          <Button variant="contained" color="primary" disabled={uploading} className={classes.buttonImport} onClick={() => processImport()}>
            Importar dados
          </Button>
          <Button variant="contained" color="secondary" disabled={uploading} onClick={() => { setRows(null); setColumns(null) }}>
            Cancelar
          </Button>
          {error && <div className={classes.error}>{error}</div>}
        </div>
      </div>
    );
  };

  const { getRootProps, getInputProps } = useDropzone({
    onDrop: onChangeFile,
    maxFiles: 1,
  });

  return (
    <div style={{ alignContent: "center" }}>
      {imported && (
        <div>
          <ul>
            <li>{countCreated} contatos criados</li>
            <li>{countIgnored} contatos ignorados (número inválido ou não marcados para atualizar)</li>
          </ul>
        </div>
      )}
      {openingFile && <div>Processando arquivo...</div>}
      {invalidFile && <div>Arquivo inválido!</div>}
      {!imported && rows && columns ? renderContent() :
        <div {...getRootProps()} className="uploaderDrop" style={{ borderRadius: 20, maxWidth: 500, margin: '20px auto', border: '3px dotted #ddd', padding: 20, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
          <img src={upload} height={200} />
          <h5>Clique ou arraste um arquivo</h5>
          <p style={{ color: '#e74c3c', fontWeight: 'bold', textAlign: 'center' }}>
            * Importante: Arquivos somente com extensões são aceitas: xls, xslx, csv, txt</p></div>}
      <input {...getInputProps()} />
      <div className={classes.backButtonContainer}>
        <Button variant="contained" color="secondary" disabled={uploading} onClick={handleCloseImport}>
          Voltar
        </Button>
      </div>
    </div>

  );
};

export default ContactImport;