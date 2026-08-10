import type { BankProvider, CardTransactionQuery, PageOptions, TransactionQuery } from "../types.js";

const accounts = {
  hspBlg: [
    {
      hspTml: {
        hspRef: "mock-garanti-try-001",
        hspNo: "TR000000000000000000000001",
        kisaAd: "Ana TL Hesabı",
        prBrm: "TRY",
        hspTur: "Vadesiz",
        hspDrm: "A"
      }
    }
  ]
};

const balances = {
  bkyBlg: [
    {
      hspRef: "mock-garanti-try-001",
      bky: {
        bkyTtr: 42850.25,
        blkTtr: 0,
        prBrm: "TRY",
        bkyZmn: new Date().toISOString()
      }
    }
  ]
};

const cards = {
  kartBilgileri: [
    {
      kartRef: "mock-card-001",
      kartNo: "5406********1234",
      kartTipi: "K",
      kartFormu: "F",
      kartUrunAdi: "Mock Bonus"
    }
  ]
};

function mockTransactions(accountRef: string) {
  return {
    hspRef: accountRef,
    isller: [
      {
        islTml: {
          islNo: "tx-001",
          refNo: "salary-001",
          islTtr: 65000,
          gnclBky: 65000,
          prBrm: "TRY",
          islGrckZaman: "2026-08-01T09:00:00+03:00",
          brcAlc: "A",
          islTur: "HAVALE"
        },
        islDty: { islAcklm: "Maaş" }
      },
      {
        islTml: {
          islNo: "tx-002",
          refNo: "rent-001",
          islTtr: 18000,
          gnclBky: 47000,
          prBrm: "TRY",
          islGrckZaman: "2026-08-02T10:30:00+03:00",
          brcAlc: "B",
          islTur: "FAST"
        },
        islDty: { islAcklm: "Kira", krsTrf: { krsUnvan: "Ev Sahibi" } }
      },
      {
        islTml: {
          islNo: "tx-003",
          refNo: "market-001",
          islTtr: 1249.75,
          gnclBky: 45750.25,
          prBrm: "TRY",
          islGrckZaman: "2026-08-04T18:15:00+03:00",
          brcAlc: "B",
          islTur: "KART"
        },
        islDty: { islAcklm: "Market harcaması" }
      }
    ]
  };
}

function mockCardTransactions(cardRef: string) {
  return {
    kartRef: cardRef,
    hareketBilgileri: [
      {
        islemNo: "card-001",
        islemTutari: { tutar: 229.99, paraBirimi: "TRY" },
        islemTarihi: "2026-08-03T03:10:00+03:00",
        borcAlacak: "B",
        islemAciklamasi: "NETFLIX.COM"
      },
      {
        islemNo: "card-002",
        islemTutari: { tutar: 79.99, paraBirimi: "TRY" },
        islemTarihi: "2026-08-05T04:05:00+03:00",
        borcAlacak: "B",
        islemAciklamasi: "SPOTIFY"
      },
      {
        islemNo: "card-003",
        islemTutari: { tutar: 1480.5, paraBirimi: "TRY" },
        islemTarihi: "2026-08-07T19:40:00+03:00",
        borcAlacak: "B",
        islemAciklamasi: "MARKET"
      }
    ]
  };
}

export class MockBankProvider implements BankProvider {
  readonly name = "mock";
  readonly specVersion = "2.0.0";

  status() {
    return {
      provider: this.name,
      specVersion: this.specVersion,
      live: false,
      readOnly: true,
      message: "Static mock data; no bank connection is active."
    };
  }

  async listAccounts(_options?: PageOptions) {
    return accounts;
  }

  async getBalances(_options?: PageOptions) {
    return balances;
  }

  async listTransactions(query: TransactionQuery) {
    return mockTransactions(query.accountRef);
  }

  async listCards(_options?: PageOptions) {
    return cards;
  }

  async listCardTransactions(query: CardTransactionQuery) {
    return mockCardTransactions(query.cardRef);
  }
}
